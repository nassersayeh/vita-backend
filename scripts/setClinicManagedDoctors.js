/**
 * Script: Set clinic doctors as managedByClinic and link existing appointments to the clinic
 * 
 * Run with: node scripts/setClinicManagedDoctors.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.vefyn0g.mongodb.net/?appName=Cluster0')
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error(err); process.exit(1); });

const User = require('../models/User');
const Clinic = require('../models/Clinic');
const Appointment = require('../models/Appointment');

const CLINIC_NAME = 'مركز الشعب الطبي';

async function run() {
  console.log('🏥 Setting up clinic-managed doctors...\n');

  const clinic = await Clinic.findOne({ name: CLINIC_NAME });
  if (!clinic) {
    console.error('❌ Clinic not found!');
    process.exit(1);
  }
  console.log(`✅ Found clinic: ${clinic.name} (ID: ${clinic._id})\n`);

  // Get all active doctors in the clinic
  const doctorIds = clinic.doctors
    .filter(d => d.status === 'active')
    .map(d => d.doctorId);

  const doctors = await User.find({ _id: { $in: doctorIds } });

  console.log(`📋 Found ${doctors.length} active doctors to update:\n`);

  for (const doctor of doctors) {
    console.log(`👨‍⚕️ ${doctor.fullName} (${doctor.mobileNumber})`);
    
    // Set managedByClinic flag
    doctor.managedByClinic = true;
    doctor.clinicId = clinic._id;
    await doctor.save({ validateBeforeSave: false });
    console.log('   ✅ Set managedByClinic = true');

    // Link existing appointments to the clinic
    const result = await Appointment.updateMany(
      { doctorId: doctor._id, clinicId: { $exists: false } },
      { $set: { clinicId: clinic._id } }
    );
    const result2 = await Appointment.updateMany(
      { doctorId: doctor._id, clinicId: null },
      { $set: { clinicId: clinic._id } }
    );
    const totalUpdated = (result.modifiedCount || 0) + (result2.modifiedCount || 0);
    console.log(`   📅 Linked ${totalUpdated} existing appointments to clinic`);
    console.log('');
  }

  // Verify
  const totalLinked = await Appointment.countDocuments({ clinicId: clinic._id });
  console.log(`\n🎉 Done! ${doctors.length} doctors set as clinic-managed.`);
  console.log(`📅 Total appointments linked to clinic: ${totalLinked}`);
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
