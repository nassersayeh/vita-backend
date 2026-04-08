const mongoose = require('mongoose');
const User = require('./models/User');
const Clinic = require('./models/Clinic');
const DoctorPatientRequest = require('./models/DoctorPatientRequest');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function fixDoctorAhmedPatients() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find doctor Ahmed
    const doctor = await User.findOne({ mobileNumber: '0598491649' });
    if (!doctor) {
      console.log('❌ Doctor not found');
      await mongoose.disconnect();
      return;
    }
    console.log(`Doctor: ${doctor.fullName} (ID: ${doctor._id})`);

    // Find clinic
    const clinic = await Clinic.findById(doctor.clinicId);
    if (!clinic) {
      console.log('❌ Clinic not found');
      await mongoose.disconnect();
      return;
    }

    // Get all other active doctors in clinic
    const otherDoctorIds = clinic.doctors
      .filter(d => d.status === 'active' && d.doctorId.toString() !== doctor._id.toString())
      .map(d => d.doctorId);

    const otherDoctors = await User.find({ _id: { $in: otherDoctorIds } });
    
    // Collect all unique patient IDs from other doctors
    const allPatientIds = new Set();
    for (const od of otherDoctors) {
      if (od.patients && od.patients.length > 0) {
        od.patients.forEach(p => {
          if (p) allPatientIds.add(p.toString());
        });
      }
    }

    console.log(`\nFound ${allPatientIds.size} unique patients from other clinic doctors`);

    if (allPatientIds.size === 0) {
      console.log('No patients to add');
      await mongoose.disconnect();
      return;
    }

    // Add all patients to Ahmed's patients array
    const patientIdsArray = Array.from(allPatientIds).map(id => new mongoose.Types.ObjectId(id));
    
    // Update doctor's patients array
    await User.findByIdAndUpdate(doctor._id, {
      $addToSet: { patients: { $each: patientIdsArray } }
    });
    console.log(`✅ Added ${patientIdsArray.length} patients to doctor Ahmed's patients array`);

    // Create DoctorPatientRequest records for each patient
    let created = 0;
    for (const patientId of patientIdsArray) {
      const existing = await DoctorPatientRequest.findOne({
        doctor: doctor._id,
        patient: patientId
      });
      
      if (!existing) {
        await DoctorPatientRequest.create({
          doctor: doctor._id,
          patient: patientId,
          status: 'accepted'
        });
        created++;
      }
    }
    console.log(`✅ Created ${created} DoctorPatientRequest records`);

    // Verify
    const updatedDoctor = await User.findById(doctor._id);
    console.log(`\n✅ Doctor Ahmed now has ${updatedDoctor.patients.length} patients`);

    // List patient names
    const patients = await User.find({ _id: { $in: updatedDoctor.patients } }).select('fullName mobileNumber');
    console.log('\nPatients:');
    patients.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.fullName} (${p.mobileNumber})`);
    });

    await mongoose.disconnect();
    console.log('\n✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    await mongoose.disconnect();
  }
}

fixDoctorAhmedPatients();
