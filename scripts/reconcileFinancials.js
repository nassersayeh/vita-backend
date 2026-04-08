/**
 * Financial Reconciliation Script
 * ================================
 * This script fixes inconsistencies between Financial.debts and Appointment.debt
 * 
 * Problems it fixes:
 * 1. Duplicate debts in Financial.debts (same patient, same amount, both pending)
 * 2. Financial.debts showing debt for appointments that are already paid
 * 3. Appointment.debt out of sync with Financial.debts
 * 4. Stale "paid" debt entries that can be cleaned up
 * 
 * Usage: node scripts/reconcileFinancials.js [--fix]
 *   Without --fix: DRY RUN - only shows what would be fixed
 *   With --fix: Actually applies the fixes
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';
const FIX_MODE = process.argv.includes('--fix');

async function run() {
  console.log('🔄 Financial Reconciliation Script');
  console.log(`   Mode: ${FIX_MODE ? '🔧 FIX (will modify data)' : '👁️ DRY RUN (read-only)'}`);
  console.log('');

  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const Financial = require('../models/Financial');
  const Appointment = require('../models/Appointment');
  const User = require('../models/User');
  const Clinic = require('../models/Clinic');

  // Get all clinics
  const clinics = await Clinic.find({}).populate('ownerId', 'fullName');
  console.log(`📋 Found ${clinics.length} clinics\n`);

  let totalIssues = 0;
  let totalFixed = 0;

  for (const clinic of clinics) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🏥 Clinic: ${clinic.name} (Owner: ${clinic.ownerId?.fullName || 'N/A'})`);
    console.log(`${'='.repeat(60)}`);

    const clinicOwnerId = clinic.ownerId?._id || clinic.ownerId;
    if (!clinicOwnerId) {
      console.log('  ⚠️ No owner ID, skipping');
      continue;
    }

    const doctorIds = clinic.doctors?.filter(d => d.status === 'active').map(d => d.doctorId) || [];

    // Get the clinic owner's financial record
    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      console.log('  ℹ️ No financial record found');
      continue;
    }

    const pendingDebts = (financial.debts || []).filter(d => d.status === 'pending');
    console.log(`  📊 Total pending debts in Financial: ${pendingDebts.length}`);
    console.log(`  💰 Total pending amount: ₪${pendingDebts.reduce((s, d) => s + d.amount, 0)}`);

    // ==========================================
    // CHECK 1: Find duplicate debts
    // ==========================================
    console.log('\n  --- Check 1: Duplicate debts ---');
    const debtsByPatient = {};
    for (const debt of pendingDebts) {
      const pid = debt.patientId?.toString() || 'unknown';
      if (!debtsByPatient[pid]) debtsByPatient[pid] = [];
      debtsByPatient[pid].push(debt);
    }

    let duplicatesFound = 0;
    for (const [patientId, debts] of Object.entries(debtsByPatient)) {
      if (debts.length <= 1) continue;

      // Check for exact duplicate amounts with close dates (within 5 minutes)
      for (let i = 0; i < debts.length; i++) {
        for (let j = i + 1; j < debts.length; j++) {
          const d1 = debts[i];
          const d2 = debts[j];
          const timeDiff = Math.abs(new Date(d1.date) - new Date(d2.date));
          
          if (d1.amount === d2.amount && timeDiff < 5 * 60 * 1000) {
            // Same amount, within 5 minutes = likely duplicate
            const patient = await User.findById(patientId, 'fullName').lean();
            console.log(`  ⚠️ DUPLICATE: Patient ${patient?.fullName || patientId}`);
            console.log(`     Debt 1: ₪${d1.amount} - "${d1.description}" (${d1.date})`);
            console.log(`     Debt 2: ₪${d2.amount} - "${d2.description}" (${d2.date})`);
            duplicatesFound++;
            totalIssues++;

            if (FIX_MODE) {
              // Mark the second one as paid (remove the duplicate)
              d2.status = 'paid';
              d2.amount = 0;
              d2.paidAt = new Date();
              totalFixed++;
              console.log(`     ✅ Fixed: Marked duplicate as paid`);
            }
          }
        }
      }
    }
    console.log(`  ${duplicatesFound === 0 ? '✅' : '❌'} Duplicates found: ${duplicatesFound}`);

    // ==========================================
    // CHECK 2: Debts for already-paid appointments
    // ==========================================
    console.log('\n  --- Check 2: Debts for paid appointments ---');
    let staleDebts = 0;

    for (const debt of pendingDebts) {
      if (debt.status !== 'pending') continue;
      const patientId = debt.patientId?.toString();
      if (!patientId) continue;

      // Find paid appointments for this patient in this clinic
      const paidAppointments = await Appointment.find({
        patient: patientId,
        doctorId: { $in: doctorIds },
        isPaid: true
      }).lean();

      // Check if the debt amount matches any paid appointment's fee
      for (const apt of paidAppointments) {
        const aptFee = (apt.clinicFee || apt.appointmentFee || 0);
        if (debt.amount === aptFee && aptFee > 0) {
          const patient = await User.findById(patientId, 'fullName').lean();
          console.log(`  ⚠️ STALE DEBT: Patient ${patient?.fullName || patientId} has pending ₪${debt.amount} but appointment is PAID`);
          staleDebts++;
          totalIssues++;

          if (FIX_MODE) {
            debt.status = 'paid';
            debt.amount = 0;
            debt.paidAt = new Date();
            totalFixed++;
            console.log(`     ✅ Fixed: Marked debt as paid`);
          }
          break;
        }
      }
    }
    console.log(`  ${staleDebts === 0 ? '✅' : '❌'} Stale debts found: ${staleDebts}`);

    // ==========================================
    // CHECK 3: Sync Appointment.debt with reality
    // ==========================================
    console.log('\n  --- Check 3: Appointment.debt sync ---');
    const unpaidAppointments = await Appointment.find({
      doctorId: { $in: doctorIds },
      isPaid: false,
      status: { $in: ['confirmed', 'completed'] }
    });
    
    let appointmentDebtTotal = unpaidAppointments.reduce((s, a) => s + (a.debt || 0), 0);
    const recalculatedFinancialDebt = financial.debts
      .filter(d => d.status === 'pending')
      .reduce((s, d) => s + d.amount, 0);

    console.log(`  Appointment.debt total: ₪${appointmentDebtTotal}`);
    console.log(`  Financial.debts total: ₪${recalculatedFinancialDebt}`);
    
    if (Math.abs(appointmentDebtTotal - recalculatedFinancialDebt) > 1) {
      console.log(`  ❌ MISMATCH: Difference of ₪${Math.abs(appointmentDebtTotal - recalculatedFinancialDebt)}`);
      totalIssues++;
    } else {
      console.log(`  ✅ In sync (or close enough)`);
    }

    // ==========================================
    // CHECK 4: Zero-amount pending debts
    // ==========================================
    console.log('\n  --- Check 4: Zero-amount pending debts ---');
    const zeroDebts = financial.debts.filter(d => d.status === 'pending' && d.amount <= 0);
    if (zeroDebts.length > 0) {
      console.log(`  ⚠️ Found ${zeroDebts.length} pending debts with ₪0 amount`);
      totalIssues += zeroDebts.length;
      if (FIX_MODE) {
        for (const zd of zeroDebts) {
          zd.status = 'paid';
          zd.paidAt = new Date();
          totalFixed++;
        }
        console.log(`  ✅ Fixed: Marked all zero-amount debts as paid`);
      }
    } else {
      console.log(`  ✅ No zero-amount pending debts`);
    }

    // Save if in fix mode
    if (FIX_MODE) {
      financial.markModified('debts');
      await financial.save();
      console.log('\n  💾 Financial record saved');
    }
  }

  // ==========================================
  // GLOBAL: Recalculate totalEarnings
  // ==========================================
  console.log(`\n\n${'='.repeat(60)}`);
  console.log('📊 SUMMARY');
  console.log(`${'='.repeat(60)}`);
  console.log(`Total issues found: ${totalIssues}`);
  if (FIX_MODE) {
    console.log(`Total issues fixed: ${totalFixed}`);
  } else {
    console.log(`\n💡 Run with --fix flag to apply fixes:`);
    console.log(`   node scripts/reconcileFinancials.js --fix`);
  }

  await mongoose.disconnect();
  console.log('\n✅ Done');
}

run().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
