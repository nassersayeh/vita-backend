/**
 * Script: Move lab test debt payments from doctors to clinic owner only
 * 
 * Lab debt payments should NOT appear in doctor's Financial.
 * They should only be in clinic owner's Financial (central ledger).
 */

const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected\n');

  const Clinic = require('../models/Clinic');
  const User = require('../models/User');
  const Financial = require('../models/Financial');

  const clinic = await Clinic.findOne({ name: /الشعب/i });
  const clinicOwnerId = clinic.ownerId;
  const doctors = clinic.doctors.filter(d => d.status === 'active');

  const ownerFin = await Financial.findOne({ doctorId: clinicOwnerId });

  // ============ STEP 1: Identify lab-related transactions on clinic owner ============
  console.log('=== CLINIC OWNER TRANSACTIONS - Identifying lab payments ===\n');
  
  const labKeywords = ['فحوصات', 'مخبرية', 'فحص', 'lab'];
  const labDebtPaymentKeywords = ['دفعة مريض', 'دفع دين'];
  
  // Get all debts that are lab-related (have description with فحوصات مخبرية)
  const labDebts = (ownerFin.debts || []).filter(d => 
    d.description && d.description.includes('فحوصات مخبرية')
  );
  
  // Get patient IDs that have lab debts
  const labDebtPatientIds = new Set(labDebts.map(d => d.patientId?.toString()).filter(Boolean));
  
  console.log(`Lab debts found: ${labDebts.length}`);
  console.log(`Patients with lab debts: ${labDebtPatientIds.size}`);
  console.log('Lab debt patients:', [...labDebtPatientIds]);

  // Now find which transactions on owner are "دفعة مريض" for lab debt patients
  // These are the ones that got wrongly copied to doctors
  const ownerTxs = ownerFin.transactions || [];
  
  const labPaymentTxs = [];
  const nonLabPaymentTxs = [];
  
  for (const tx of ownerTxs) {
    const pid = tx.patientId?.toString();
    const isDebtPayment = tx.description && (
      tx.description.includes('دفعة مريض') || 
      tx.description.includes('دفع دين')
    );
    const isLabPatient = labDebtPatientIds.has(pid);
    
    if (isDebtPayment && isLabPatient) {
      labPaymentTxs.push(tx);
    } else {
      nonLabPaymentTxs.push(tx);
    }
  }

  console.log(`\nLab debt payment transactions: ${labPaymentTxs.length}`);
  for (const tx of labPaymentTxs) {
    const patient = tx.patientId ? await User.findById(tx.patientId).select('fullName') : null;
    console.log(`  ₪${tx.amount} | ${tx.description} | ${patient?.fullName || '?'} | ${tx.date?.toISOString().split('T')[0]}`);
  }
  const labPaymentTotal = labPaymentTxs.reduce((s, t) => s + t.amount, 0);
  console.log(`  Total lab payments: ₪${labPaymentTotal}`);

  // ============ STEP 2: Remove lab payment transactions from doctors ============
  console.log('\n=== FIXING DOCTOR FINANCIALS ===\n');

  // Build a set of lab payment identifiers (amount + patientId + date) to match
  const labPaymentKeys = new Set(labPaymentTxs.map(tx => 
    `${tx.patientId?.toString()}_${tx.amount}_${tx.date?.toISOString()}`
  ));

  for (const doc of doctors) {
    const user = await User.findById(doc.doctorId).select('fullName');
    const docFin = await Financial.findOne({ doctorId: doc.doctorId });
    if (!docFin || !docFin.transactions?.length) continue;

    const oldTxCount = docFin.transactions.length;
    const oldEarnings = docFin.totalEarnings;

    // Filter out transactions that match lab payments
    const cleanTxs = [];
    let removedAmount = 0;
    let removedCount = 0;

    for (const tx of docFin.transactions) {
      const key = `${tx.patientId?.toString()}_${tx.amount}_${tx.date?.toISOString()}`;
      if (labPaymentKeys.has(key)) {
        removedAmount += tx.amount;
        removedCount++;
        console.log(`  ❌ Removing from ${user?.fullName}: ₪${tx.amount} | ${tx.description} | ${tx.date?.toISOString().split('T')[0]}`);
      } else {
        cleanTxs.push(tx);
      }
    }

    if (removedCount > 0) {
      docFin.transactions = cleanTxs;
      docFin.totalEarnings = cleanTxs.reduce((s, t) => s + t.amount, 0);
      docFin.markModified('transactions');
      await docFin.save();
      console.log(`  ✅ ${user?.fullName}: ₪${oldEarnings} (${oldTxCount} tx) → ₪${docFin.totalEarnings} (${cleanTxs.length} tx) [removed ${removedCount} lab payments = ₪${removedAmount}]`);
    } else {
      console.log(`  ✅ ${user?.fullName}: No lab payments found, OK`);
    }
  }

  // ============ STEP 3: Verify final state ============
  console.log('\n=== FINAL STATE ===\n');
  
  let totalDoctors = 0;
  for (const doc of doctors) {
    const user = await User.findById(doc.doctorId).select('fullName');
    const docFin = await Financial.findOne({ doctorId: doc.doctorId });
    const earnings = docFin?.totalEarnings || 0;
    totalDoctors += earnings;
    console.log(`  ${(user?.fullName || '?').padEnd(20)} ₪${earnings}`);
  }
  
  console.log(`\n  Sum doctors: ₪${totalDoctors}`);
  console.log(`  Clinic owner (central): ₪${ownerFin.totalEarnings}`);
  console.log(`  Lab payments (clinic only): ₪${labPaymentTotal}`);
  console.log(`  Non-lab payments (doctors): ₪${ownerFin.totalEarnings - labPaymentTotal}`);
  console.log(`  Doctors total should = non-lab: ${totalDoctors === ownerFin.totalEarnings - labPaymentTotal ? '✅' : '⚠️ ' + (ownerFin.totalEarnings - labPaymentTotal)}`);

  await mongoose.connection.close();
  console.log('\n🔌 Done!');
}

run().catch(err => { console.error('❌', err); mongoose.connection.close(); process.exit(1); });
