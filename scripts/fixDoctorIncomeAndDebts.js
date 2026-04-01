/**
 * Migration Script: Fix Doctor Income & Patient Debts
 * 
 * This script:
 * 1. Finds all completed & paid appointments
 * 2. Adds income to the doctor's financial record (if missing)
 * 3. Clears corresponding patient debts from the clinic owner's financial
 * 
 * Usage: node scripts/fixDoctorIncomeAndDebts.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB - same URI as server.js
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb+srv://nassersayeh:pop1990@cluster0.vefyn0g.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGO_URI).then(() => {
  console.log('✅ MongoDB connected');
  runMigration();
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

async function runMigration() {
  try {
    const Appointment = require('../models/Appointment');
    const Financial = require('../models/Financial');
    const Clinic = require('../models/Clinic');
    const User = require('../models/User');

    console.log('\n========================================');
    console.log('  Fix Doctor Income & Patient Debts');
    console.log('========================================\n');

    // 1. Get all clinics
    const clinics = await Clinic.find({});
    console.log(`📋 Found ${clinics.length} clinics\n`);

    let totalDoctorIncomeAdded = 0;
    let totalDebtsCleared = 0;
    let totalAppointmentsProcessed = 0;

    for (const clinic of clinics) {
      console.log(`\n🏥 Processing clinic: ${clinic.name} (owner: ${clinic.ownerId})`);

      const clinicOwnerId = clinic.ownerId;
      const doctorIds = clinic.doctors
        .filter(d => d.status === 'active')
        .map(d => d.doctorId);

      // Get clinic owner's financial
      let clinicFinancial = await Financial.findOne({ doctorId: clinicOwnerId });
      if (!clinicFinancial) {
        console.log('  ⚠️  No financial record for clinic owner, creating one...');
        clinicFinancial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
        await clinicFinancial.save();
      }

      // 2. Find all paid appointments for this clinic's doctors
      const allDoctorIds = [...doctorIds];
      if (!allDoctorIds.some(id => id.toString() === clinicOwnerId.toString())) {
        allDoctorIds.push(clinicOwnerId);
      }

      const paidAppointments = await Appointment.find({
        doctorId: { $in: allDoctorIds },
        isPaid: true,
        appointmentFee: { $gt: 0 }
      }).populate('patient', 'fullName').populate('doctorId', 'fullName');

      console.log(`  📅 Found ${paidAppointments.length} paid appointments`);

      for (const apt of paidAppointments) {
        const doctorId = apt.doctorId._id.toString();
        const patientId = apt.patient?._id?.toString();
        const fee = apt.appointmentFee || 0;
        const patientName = apt.patient?.fullName || 'Unknown';
        const doctorName = apt.doctorId?.fullName || 'Unknown';

        // 3. Add income to doctor's financial if doctor != clinic owner
        if (doctorId !== clinicOwnerId.toString() && fee > 0) {
          let doctorFinancial = await Financial.findOne({ doctorId: doctorId });
          if (!doctorFinancial) {
            doctorFinancial = new Financial({ doctorId: doctorId, totalEarnings: 0, totalExpenses: 0 });
          }

          // Check if this appointment income already exists
          const existingTransaction = doctorFinancial.transactions.find(t =>
            t.appointmentId?.toString() === apt._id.toString()
          );

          if (!existingTransaction) {
            doctorFinancial.transactions.push({
              amount: fee,
              description: `كشفية موعد - ${clinic.name}`,
              date: apt.paidAt || apt.appointmentDateTime || new Date(),
              patientId: apt.patient?._id,
              appointmentId: apt._id,
              paymentMethod: 'Cash',
            });
            doctorFinancial.totalEarnings = (doctorFinancial.totalEarnings || 0) + fee;
            await doctorFinancial.save();
            totalDoctorIncomeAdded++;
            console.log(`  💰 Added ₪${fee} income to Dr. ${doctorName} for patient ${patientName}`);
          }
        }

        totalAppointmentsProcessed++;
      }

      // 4. Clear paid debts from clinic owner's financial
      if (clinicFinancial.debts && clinicFinancial.debts.length > 0) {
        let debtsCleared = 0;

        for (const debt of clinicFinancial.debts) {
          if (debt.status === 'pending' && debt.patientId) {
            const patientId = debt.patientId.toString();

            // Check if the patient has any paid appointments that cover this debt
            const paidApts = await Appointment.find({
              patient: patientId,
              doctorId: { $in: allDoctorIds },
              isPaid: true,
              appointmentFee: { $gt: 0 }
            });

            // Sum total paid
            const totalPaid = paidApts.reduce((sum, a) => sum + (a.paymentAmount || a.appointmentFee || 0), 0);

            // Sum total pending debts for this patient
            const patientPendingDebts = clinicFinancial.debts.filter(d =>
              d.patientId?.toString() === patientId && d.status === 'pending'
            );
            const totalPendingDebt = patientPendingDebts.reduce((sum, d) => sum + d.amount, 0);

            // Check if there are income transactions for this patient too
            const patientIncome = clinicFinancial.transactions
              .filter(t => t.patientId?.toString() === patientId)
              .reduce((sum, t) => sum + t.amount, 0);

            const totalCovered = totalPaid + patientIncome;

            // If total paid/income covers debts, clear them
            if (totalCovered >= totalPendingDebt) {
              for (const pd of patientPendingDebts) {
                pd.status = 'paid';
                pd.amount = 0;
                debtsCleared++;
              }
            }
          }
        }

        if (debtsCleared > 0) {
          clinicFinancial.markModified('debts');
          await clinicFinancial.save();
          totalDebtsCleared += debtsCleared;
          console.log(`  🧹 Cleared ${debtsCleared} paid debts from clinic financial`);
        }
      }
    }

    console.log('\n========================================');
    console.log('  Migration Complete!');
    console.log('========================================');
    console.log(`  📊 Appointments processed: ${totalAppointmentsProcessed}`);
    console.log(`  💰 Doctor income records added: ${totalDoctorIncomeAdded}`);
    console.log(`  🧹 Patient debts cleared: ${totalDebtsCleared}`);
    console.log('========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration error:', error);
    process.exit(1);
  }
}
