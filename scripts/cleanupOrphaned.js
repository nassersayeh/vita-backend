/**
 * Find and clean up orphaned data from deleted patients
 * Usage: node scripts/cleanupOrphaned.js          (dry run)
 *        node scripts/cleanupOrphaned.js --fix     (actually delete)
 */
const mongoose = require('mongoose');
const FIX = process.argv.includes('--fix');

async function run() {
  await mongoose.connect('mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net');
  console.log('Connected to MongoDB');
  console.log('Mode:', FIX ? '🔧 FIX' : '👁️ DRY RUN');

  const User = require('../models/User');
  const Appointment = require('../models/Appointment');
  const MedicalRecord = require('../models/MedicalRecord');
  const Financial = require('../models/Financial');
  const LabRequest = require('../models/LabRequest');

  // Get all existing patient IDs
  const allPatients = await User.find({ role: 'Patient' }, '_id');
  const patientIdSet = new Set(allPatients.map(u => u._id.toString()));
  console.log(`\nExisting patients: ${patientIdSet.size}`);

  // 1. Orphaned appointments
  const allApts = await Appointment.find({});
  const orphanedApts = allApts.filter(a => a.patient && !patientIdSet.has(a.patient.toString()));
  console.log(`\n=== Orphaned Appointments: ${orphanedApts.length} ===`);
  for (const a of orphanedApts) {
    console.log(`  ${a._id} | patient: ${a.patient} | date: ${a.appointmentDateTime?.toISOString()?.split('T')[0]} | fee: ${a.appointmentFee} | debt: ${a.debt} | paid: ${a.isPaid}`);
  }
  if (FIX && orphanedApts.length > 0) {
    const ids = orphanedApts.map(a => a._id);
    const result = await Appointment.deleteMany({ _id: { $in: ids } });
    console.log(`  ✅ Deleted ${result.deletedCount} orphaned appointments`);
  }

  // 2. Orphaned medical records
  const allRecs = await MedicalRecord.find({});
  const orphanedRecs = allRecs.filter(r => r.patient && !patientIdSet.has(r.patient.toString()));
  console.log(`\n=== Orphaned Medical Records: ${orphanedRecs.length} ===`);
  for (const r of orphanedRecs) {
    console.log(`  ${r._id} | patient: ${r.patient} | doctor: ${r.doctorId}`);
  }
  if (FIX && orphanedRecs.length > 0) {
    const ids = orphanedRecs.map(r => r._id);
    const result = await MedicalRecord.deleteMany({ _id: { $in: ids } });
    console.log(`  ✅ Deleted ${result.deletedCount} orphaned medical records`);
  }

  // 3. Orphaned lab requests
  const allLabs = await LabRequest.find({});
  const orphanedLabs = allLabs.filter(l => l.patientId && !patientIdSet.has(l.patientId.toString()));
  console.log(`\n=== Orphaned Lab Requests: ${orphanedLabs.length} ===`);
  for (const l of orphanedLabs) {
    console.log(`  ${l._id} | patient: ${l.patientId}`);
  }
  if (FIX && orphanedLabs.length > 0) {
    const ids = orphanedLabs.map(l => l._id);
    const result = await LabRequest.deleteMany({ _id: { $in: ids } });
    console.log(`  ✅ Deleted ${result.deletedCount} orphaned lab requests`);
  }

  // 4. Orphaned financial entries (debts + transactions)
  const allFinancials = await Financial.find({});
  let orphanedDebts = 0;
  let orphanedTxns = 0;

  for (const fin of allFinancials) {
    let modified = false;

    // Check debts
    const debtsToRemove = [];
    for (const d of (fin.debts || [])) {
      if (d.patientId && !patientIdSet.has(d.patientId.toString())) {
        orphanedDebts++;
        console.log(`\n  Orphaned debt: ${d._id} | patient: ${d.patientId} | ₪${d.amount} | ${d.status} | ${d.description}`);
        debtsToRemove.push(d._id);
      }
    }

    // Check transactions
    const txnsToRemove = [];
    for (const t of (fin.transactions || [])) {
      if (t.patientId && !patientIdSet.has(t.patientId.toString())) {
        orphanedTxns++;
        console.log(`  Orphaned txn: ${t._id} | patient: ${t.patientId} | ₪${t.amount} | ${t.description}`);
        txnsToRemove.push(t._id);
      }
    }

    if (FIX && (debtsToRemove.length > 0 || txnsToRemove.length > 0)) {
      for (const id of debtsToRemove) {
        const debt = fin.debts.id(id);
        if (debt) {
          // Adjust totalEarnings if this was a paid debt (unlikely but safe)
          fin.debts.pull(id);
        }
      }
      for (const id of txnsToRemove) {
        const txn = fin.transactions.id(id);
        if (txn) {
          fin.totalEarnings = (fin.totalEarnings || 0) - (txn.amount || 0);
          fin.transactions.pull(id);
        }
      }
      await fin.save();
      modified = true;
      console.log(`  ✅ Cleaned financial record for doctor ${fin.doctorId}`);
    }
  }

  console.log(`\n=== Orphaned Financial Data ===`);
  console.log(`  Orphaned debts: ${orphanedDebts}`);
  console.log(`  Orphaned transactions: ${orphanedTxns}`);

  // 5. Check if deleted patients still appear in doctors' patient arrays
  const allDoctors = await User.find({ role: 'Doctor' }, 'fullName patients');
  let orphanedRefs = 0;
  for (const doc of allDoctors) {
    const orphaned = (doc.patients || []).filter(pid => !patientIdSet.has(pid.toString()));
    if (orphaned.length > 0) {
      orphanedRefs += orphaned.length;
      console.log(`\n  Doctor ${doc.fullName} has ${orphaned.length} orphaned patient refs: ${orphaned.join(', ')}`);
      if (FIX) {
        doc.patients = doc.patients.filter(pid => patientIdSet.has(pid.toString()));
        await doc.save({ validateBeforeSave: false });
        console.log(`  ✅ Cleaned doctor's patient list`);
      }
    }
  }
  console.log(`\nOrphaned doctor->patient refs: ${orphanedRefs}`);

  console.log('\n=== SUMMARY ===');
  console.log(`Orphaned appointments: ${orphanedApts.length}`);
  console.log(`Orphaned medical records: ${orphanedRecs.length}`);
  console.log(`Orphaned lab requests: ${orphanedLabs.length}`);
  console.log(`Orphaned debts: ${orphanedDebts}`);
  console.log(`Orphaned transactions: ${orphanedTxns}`);
  console.log(`Orphaned doctor refs: ${orphanedRefs}`);

  if (!FIX && (orphanedApts.length + orphanedRecs.length + orphanedLabs.length + orphanedDebts + orphanedTxns + orphanedRefs > 0)) {
    console.log('\n💡 Run with --fix to clean up:');
    console.log('   node scripts/cleanupOrphaned.js --fix');
  }

  await mongoose.disconnect();
  console.log('\nDone');
}

run().catch(err => { console.error(err); process.exit(1); });
