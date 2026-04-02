/**
 * Migration script: Fix old debt payments that didn't create doctor income transactions
 * 
 * Problem: Before the revenue-split fix, when an accountant paid a debt via insertPayment,
 * the code cleared the debt on the doctor's Financial (set amount=0, status=paid) but
 * never created an income transaction on the doctor's Financial record.
 * 
 * This script:
 * 1. Finds all doctors in all clinics
 * 2. For each doctor with paid debts but no corresponding non-appointment transaction,
 *    creates the missing income transaction based on the clinic owner's payment transaction
 * 3. Sets originalAmount on paid debts that are missing it
 */

const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const Financial = require('./models/Financial');
  const Clinic = require('./models/Clinic');
  const User = require('./models/User');

  const clinics = await Clinic.find({});
  console.log(`Found ${clinics.length} clinics`);

  for (const clinic of clinics) {
    const clinicOwnerId = clinic.ownerId;
    console.log(`\n=== Clinic: ${clinic.name} (owner: ${clinicOwnerId}) ===`);

    const ownerFin = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!ownerFin) {
      console.log('  No clinic owner Financial record, skipping');
      continue;
    }

    // Get non-appointment transactions on clinic owner (these are debt payments)
    const ownerDebtPayments = (ownerFin.transactions || []).filter(t => !t.appointmentId);
    console.log(`  Clinic owner has ${ownerDebtPayments.length} non-appointment transactions`);

    const activeDoctors = (clinic.doctors || []).filter(d => d.status === 'active');

    for (const docEntry of activeDoctors) {
      const docId = docEntry.doctorId;
      const clinicPercentage = docEntry.clinicPercentage || 0;
      const doctor = await User.findById(docId, 'fullName');
      console.log(`\n  Doctor: ${doctor?.fullName || docId} (clinic pct: ${clinicPercentage}%)`);

      const docFin = await Financial.findOne({ doctorId: docId });
      if (!docFin) {
        console.log('    No Financial record, skipping');
        continue;
      }

      const paidDebts = (docFin.debts || []).filter(d => d.status === 'paid');
      const nonAptTxns = (docFin.transactions || []).filter(t => !t.appointmentId);
      console.log(`    Paid debts: ${paidDebts.length}, Non-apt transactions: ${nonAptTxns.length}`);

      // For each paid debt, check if there's a matching income transaction
      for (const debt of paidDebts) {
        const patId = debt.patientId?.toString();
        const patient = patId ? await User.findById(patId, 'fullName') : null;
        console.log(`    Paid debt: patient=${patient?.fullName || patId}, amount=${debt.amount}, originalAmount=${debt.originalAmount || 'N/A'}, desc="${debt.description}"`);

        // Check if there's already a matching transaction for this patient (non-appointment)
        const hasMatchingTxn = nonAptTxns.some(t =>
          t.patientId?.toString() === patId
        );

        if (hasMatchingTxn) {
          console.log('      ✅ Already has matching transaction, skipping');
          continue;
        }

        // No matching transaction found. Try to find the corresponding payment on clinic owner
        // Match by patientId
        const ownerPayment = ownerDebtPayments.find(t =>
          t.patientId?.toString() === patId
        );

        if (!ownerPayment) {
          console.log('      ⚠️ No matching clinic owner payment found, skipping');
          continue;
        }

        const totalPaid = ownerPayment.amount;
        console.log(`      Found clinic owner payment: ${totalPaid} NIS`);

        // Calculate doctor's share
        const doctorShare = Math.round((totalPaid * (100 - clinicPercentage) / 100) * 100) / 100;
        console.log(`      Doctor share: ${doctorShare} NIS (clinic takes ${clinicPercentage}%)`);

        // Set originalAmount on the debt if missing
        if (!debt.originalAmount) {
          debt.originalAmount = totalPaid;
          console.log(`      Set originalAmount = ${totalPaid}`);
        }
        if (!debt.paidAt) {
          debt.paidAt = ownerPayment.date || new Date();
          console.log(`      Set paidAt = ${debt.paidAt}`);
        }

        // Create the missing income transaction
        if (doctorShare > 0) {
          docFin.transactions.push({
            amount: doctorShare,
            description: `حصة الطبيب من سداد دين مريض - ${clinic.name} (${100 - clinicPercentage}%) [تصحيح]`,
            date: ownerPayment.date || new Date(),
            patientId: debt.patientId,
            paymentMethod: ownerPayment.paymentMethod || 'Cash'
          });
          docFin.totalEarnings = (docFin.totalEarnings || 0) + doctorShare;
          console.log(`      ✅ Created doctor income transaction: ${doctorShare} NIS`);
        }
      }

      docFin.markModified('debts');
      docFin.markModified('transactions');
      await docFin.save();
      console.log(`    Saved doctor Financial`);
    }

    // Also set originalAmount on clinic owner's paid debts that are missing it
    let ownerChanged = false;
    for (const debt of ownerFin.debts || []) {
      if (debt.status === 'paid' && !debt.originalAmount) {
        // Try to find the payment that matches
        const payment = ownerDebtPayments.find(t =>
          t.patientId?.toString() === debt.patientId?.toString()
        );
        if (payment) {
          debt.originalAmount = payment.amount;
          debt.paidAt = debt.paidAt || payment.date || new Date();
          ownerChanged = true;
          console.log(`  Set originalAmount=${payment.amount} on clinic owner debt for patient ${debt.patientId}`);
        }
      }
    }
    if (ownerChanged) {
      ownerFin.markModified('debts');
      await ownerFin.save();
      console.log('  Saved clinic owner Financial');
    }
  }

  console.log('\n✅ Migration complete!');
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
