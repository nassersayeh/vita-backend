/**
 * Script: Fix financials for "مركز الشعب الطبي"
 * 
 * Since clinicPercentage = 0% for ALL doctors, every payment should go 100% to the doctor.
 * 
 * Source of truth: Clinic Owner's transactions (these are the actual payments received).
 * For each transaction, we find which doctor the patient belongs to (via appointments),
 * and rebuild each doctor's Financial.totalEarnings & transactions correctly.
 * 
 * The clinic owner's totalEarnings should then equal only what belongs to the clinic (0% = nothing from appointments).
 * But since all transactions are stored there as the central ledger, we keep them but fix totalEarnings.
 */

const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const Clinic = require('../models/Clinic');
  const User = require('../models/User');
  const Financial = require('../models/Financial');
  const Appointment = require('../models/Appointment');
  const LabRequest = require('../models/LabRequest');

  const clinic = await Clinic.findOne({ name: /الشعب/i });
  if (!clinic) { console.log('❌ Clinic not found'); process.exit(1); }

  const clinicOwnerId = clinic.ownerId;
  const doctors = clinic.doctors.filter(d => d.status === 'active');
  const doctorIds = doctors.map(d => d.doctorId.toString());

  console.log(`📋 Clinic: "${clinic.name}"`);
  console.log(`   Doctors: ${doctors.length}, all with clinicPercentage = 0%\n`);

  // ============ STEP 1: Get clinic owner's transactions (source of truth) ============
  const ownerFin = await Financial.findOne({ doctorId: clinicOwnerId });
  if (!ownerFin) { console.log('❌ No owner financial'); process.exit(1); }

  const ownerTransactions = ownerFin.transactions || [];
  console.log(`📊 Owner has ${ownerTransactions.length} transactions (sum: ₪${ownerTransactions.reduce((s, t) => s + t.amount, 0)})`);

  // ============ STEP 2: For each transaction, determine which doctor it belongs to ============
  // Build a patient → doctor mapping from appointments
  const allAppointments = await Appointment.find({
    doctorId: { $in: doctorIds },
    status: { $in: ['confirmed', 'completed'] }
  });

  // Map: patientId → doctorId (from most recent appointment)
  const patientDoctorMap = {};
  // Also build: patientId → [appointments] for more precise matching
  const patientAppointments = {};
  for (const apt of allAppointments) {
    const pid = apt.patient?.toString();
    const did = apt.doctorId?.toString();
    if (!pid || !did) continue;
    if (!patientAppointments[pid]) patientAppointments[pid] = [];
    patientAppointments[pid].push(apt);
    patientDoctorMap[pid] = did; // last wins (but we'll use date-based matching below)
  }

  // Also check debts for doctor assignment
  const ownerDebts = ownerFin.debts || [];

  // ============ STEP 3: Assign each transaction to a doctor ============
  const doctorPayments = {}; // doctorId → { total, transactions[] }
  for (const did of doctorIds) {
    doctorPayments[did] = { total: 0, transactions: [] };
  }

  let unassigned = [];

  for (const tx of ownerTransactions) {
    const patientId = tx.patientId?.toString();
    let assignedDoctorId = null;

    if (patientId) {
      // Method 1: Find doctor from appointments for this patient, closest date to transaction
      const apts = patientAppointments[patientId] || [];
      if (apts.length > 0) {
        // Find the appointment closest in time to this transaction
        let closest = apts[0];
        let closestDiff = Math.abs(new Date(apts[0].appointmentDateTime) - new Date(tx.date));
        for (const apt of apts) {
          const diff = Math.abs(new Date(apt.appointmentDateTime) - new Date(tx.date));
          if (diff < closestDiff) {
            closest = apt;
            closestDiff = diff;
          }
        }
        assignedDoctorId = closest.doctorId?.toString();
      }

      // Method 2: Check if there's a debt for this patient with a doctorId
      if (!assignedDoctorId) {
        const matchingDebt = ownerDebts.find(d =>
          d.patientId?.toString() === patientId && d.doctorId
        );
        if (matchingDebt) {
          assignedDoctorId = matchingDebt.doctorId.toString();
        }
      }
    }

    // Method 3: Parse description for doctor name
    if (!assignedDoctorId && tx.description) {
      for (const doc of doctors) {
        const user = await User.findById(doc.doctorId).select('fullName');
        if (user?.fullName && tx.description.includes(user.fullName)) {
          assignedDoctorId = doc.doctorId.toString();
          break;
        }
      }
    }

    if (assignedDoctorId && doctorPayments[assignedDoctorId]) {
      doctorPayments[assignedDoctorId].total += tx.amount;
      doctorPayments[assignedDoctorId].transactions.push(tx);
    } else {
      unassigned.push({ amount: tx.amount, desc: tx.description, patientId, date: tx.date });
    }
  }

  // ============ STEP 4: Show results before fixing ============
  console.log('\n' + '='.repeat(60));
  console.log('PAYMENT ASSIGNMENT RESULTS:');
  console.log('='.repeat(60));

  for (const doc of doctors) {
    const did = doc.doctorId.toString();
    const user = await User.findById(did).select('fullName');
    const info = doctorPayments[did];
    const currentFin = await Financial.findOne({ doctorId: did });
    console.log(`\n  👨‍⚕️ ${user?.fullName || did}:`);
    console.log(`     Current totalEarnings: ₪${currentFin?.totalEarnings || 0}`);
    console.log(`     Current transactions: ${currentFin?.transactions?.length || 0}`);
    console.log(`     Correct totalEarnings: ₪${info.total} (from ${info.transactions.length} payments)`);
    if (info.total !== (currentFin?.totalEarnings || 0)) {
      console.log(`     ⚠️  DIFF: ${info.total - (currentFin?.totalEarnings || 0)}`);
    } else {
      console.log(`     ✅ OK`);
    }
  }

  if (unassigned.length > 0) {
    console.log(`\n  ⚠️  UNASSIGNED (${unassigned.length}):`);
    for (const u of unassigned) {
      console.log(`     ₪${u.amount} | ${u.desc} | patient:${u.patientId} | ${u.date?.toISOString().split('T')[0]}`);
    }
  }

  // ============ STEP 5: FIX - Rebuild each doctor's Financial ============
  console.log('\n' + '='.repeat(60));
  console.log('APPLYING FIXES...');
  console.log('='.repeat(60));

  for (const doc of doctors) {
    const did = doc.doctorId.toString();
    const user = await User.findById(did).select('fullName');
    const info = doctorPayments[did];

    let docFin = await Financial.findOne({ doctorId: did });
    if (!docFin) {
      docFin = new Financial({ doctorId: did, totalEarnings: 0, totalExpenses: 0, transactions: [], debts: [] });
    }

    const oldEarnings = docFin.totalEarnings;
    const oldTxCount = docFin.transactions?.length || 0;

    // Clear old transactions and rebuild from owner's transactions
    docFin.transactions = info.transactions.map(tx => ({
      amount: tx.amount,
      description: tx.description,
      date: tx.date,
      patientId: tx.patientId,
      appointmentId: tx.appointmentId,
      paymentMethod: tx.paymentMethod || 'Cash',
    }));

    docFin.totalEarnings = info.total;
    docFin.markModified('transactions');
    await docFin.save();

    console.log(`  ✅ ${user?.fullName}: ₪${oldEarnings} (${oldTxCount} tx) → ₪${info.total} (${info.transactions.length} tx)`);
  }

  // Fix clinic owner: totalEarnings should be the same as sum of all transactions
  // (since it's the central ledger, keep totalEarnings = sum of transactions)
  // But the "real" clinic owner earnings from percentage = 0
  const ownerTxSum = ownerTransactions.reduce((s, t) => s + t.amount, 0);
  console.log(`\n  🏥 Clinic Owner: keeping totalEarnings = ₪${ownerTxSum} (central ledger)`);
  console.log(`     (Clinic's share from percentages = ₪0 since all doctors at 0%)`);

  // ============ STEP 6: Verify debts consistency ============
  console.log('\n' + '='.repeat(60));
  console.log('DEBTS SUMMARY:');
  console.log('='.repeat(60));

  const pendingDebts = ownerFin.debts.filter(d => d.status === 'pending');
  console.log(`  Pending debts on owner: ${pendingDebts.length}`);
  for (const d of pendingDebts) {
    const patient = d.patientId ? await User.findById(d.patientId).select('fullName') : null;
    const doctor = d.doctorId ? await User.findById(d.doctorId).select('fullName') : null;
    console.log(`    ₪${d.amount} | ${d.description} | Patient: ${patient?.fullName || '?'} | Doctor: ${doctor?.fullName || '?'}`);
  }

  await mongoose.connection.close();
  console.log('\n🔌 Done! Financials fixed.');
}

run().catch(err => {
  console.error('❌ Error:', err);
  mongoose.connection.close();
  process.exit(1);
});
