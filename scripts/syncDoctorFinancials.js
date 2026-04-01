/**
 * Script: Sync existing paid appointments to doctor financial records
 * for all clinic-managed doctors
 * 
 * Run with: node scripts/syncDoctorFinancials.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.vefyn0g.mongodb.net/?appName=Cluster0')
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error(err); process.exit(1); });

const User = require('../models/User');
const Clinic = require('../models/Clinic');
const Appointment = require('../models/Appointment');
const Financial = require('../models/Financial');

async function run() {
  console.log('💰 Syncing doctor financial records from clinic appointments...\n');

  // Find all clinics
  const clinics = await Clinic.find({});
  console.log(`Found ${clinics.length} clinics\n`);

  for (const clinic of clinics) {
    console.log(`\n🏥 ${clinic.name}`);
    console.log('─'.repeat(50));

    const activeDoctorIds = clinic.doctors
      .filter(d => d.status === 'active')
      .map(d => d.doctorId);

    const doctors = await User.find({ _id: { $in: activeDoctorIds } });

    for (const doc of doctors) {
      // Find completed & paid appointments for this doctor
      const completedPaid = await Appointment.find({
        doctorId: doc._id,
        status: 'completed',
        isPaid: true,
        appointmentFee: { $gt: 0 }
      });

      if (completedPaid.length === 0) {
        console.log(`  👨‍⚕️ ${doc.fullName} - No paid appointments to sync`);
        continue;
      }

      // Get or create financial record
      let financial = await Financial.findOne({ doctorId: doc._id });
      if (!financial) {
        financial = new Financial({ doctorId: doc._id, totalEarnings: 0, totalExpenses: 0, transactions: [] });
      }

      // Check which appointments already have transactions (avoid duplicates)
      const existingAptIds = new Set(
        financial.transactions
          .filter(t => t.appointmentId)
          .map(t => t.appointmentId.toString())
      );

      let addedCount = 0;
      let addedTotal = 0;

      for (const apt of completedPaid) {
        if (existingAptIds.has(apt._id.toString())) continue; // Skip already recorded

        financial.transactions.push({
          amount: apt.appointmentFee,
          description: 'كشفية موعد - ' + clinic.name,
          date: apt.appointmentDateTime || new Date(),
          patientId: apt.patient?._id || apt.patient,
          appointmentId: apt._id,
          paymentMethod: 'Cash',
        });
        addedCount++;
        addedTotal += apt.appointmentFee;
      }

      if (addedCount > 0) {
        financial.totalEarnings = (financial.totalEarnings || 0) + addedTotal;
        await financial.save();
        console.log(`  ✅ ${doc.fullName} - Added ${addedCount} transactions, total ₪${addedTotal}`);
      } else {
        console.log(`  ⚪ ${doc.fullName} - All ${completedPaid.length} transactions already synced`);
      }

      // Also ensure patients are in doctor.patients array
      let patientsAdded = 0;
      const patientIds = [...new Set(completedPaid.map(a => a.patient?.toString()).filter(Boolean))];
      const currentPatients = new Set((doc.patients || []).map(String));

      for (const pid of patientIds) {
        if (!currentPatients.has(pid)) {
          doc.patients.push(pid);
          patientsAdded++;
        }
      }
      if (patientsAdded > 0) {
        await doc.save({ validateBeforeSave: false });
        console.log(`     📋 Added ${patientsAdded} patients to doctor's patient list`);
      }
    }
  }

  console.log('\n\n🎉 Done!');
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
