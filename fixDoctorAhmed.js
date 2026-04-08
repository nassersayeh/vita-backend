const mongoose = require('mongoose');
const User = require('./models/User');
const Clinic = require('./models/Clinic');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function fixDoctorAhmed() {
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
    console.log(`\nDoctor: ${doctor.fullName} (ID: ${doctor._id})`);
    console.log(`  managedByClinic: ${doctor.managedByClinic}`);
    console.log(`  clinicId: ${doctor.clinicId}`);
    console.log(`  activationStatus: ${doctor.activationStatus}`);
    console.log(`  patients count: ${doctor.patients ? doctor.patients.length : 0}`);

    // Find clinic
    const clinic = await Clinic.findOne({ 'doctors.doctorId': doctor._id });
    if (clinic) {
      console.log(`\nClinic: ${clinic.name} (ID: ${clinic._id})`);
      console.log(`  Owner ID: ${clinic.ownerId}`);
      const doctorEntry = clinic.doctors.find(d => d.doctorId.toString() === doctor._id.toString());
      console.log(`  Doctor status in clinic: ${doctorEntry ? doctorEntry.status : 'NOT FOUND'}`);
      
      // Find all other active doctors in clinic
      console.log('\n  All doctors in clinic:');
      for (const d of clinic.doctors) {
        const doc = await User.findById(d.doctorId);
        if (doc) {
          console.log(`    - ${doc.fullName} | Status: ${d.status} | Patients: ${doc.patients ? doc.patients.length : 0} | managedByClinic: ${doc.managedByClinic} | clinicId: ${doc.clinicId}`);
        }
      }

      // Get clinic owner
      const owner = await User.findById(clinic.ownerId);
      if (owner) {
        console.log(`\nClinic Owner: ${owner.fullName} (ID: ${owner._id})`);
        console.log(`  Patients on owner: ${owner.patients ? owner.patients.length : 0}`);
      }
    } else {
      console.log('\n❌ Doctor is NOT in any clinic doctors array!');
      
      // Check by clinicId
      if (doctor.clinicId) {
        const clinicById = await Clinic.findById(doctor.clinicId);
        if (clinicById) {
          console.log(`  But clinicId points to: ${clinicById.name}`);
          console.log(`  Clinic doctors:`, clinicById.doctors.map(d => d.doctorId.toString()));
        }
      }
    }

    // Check DoctorPatientRequest model
    try {
      const DoctorPatientRequest = require('./models/DoctorPatientRequest');
      const requests = await DoctorPatientRequest.find({ doctorId: doctor._id });
      console.log(`\nDoctorPatientRequests for Ahmed: ${requests.length}`);
    } catch (e) {
      console.log('\nNo DoctorPatientRequest model found');
    }

    // Now let's see what patients the OTHER doctors in the same clinic have
    // so we can share those patients with Ahmed
    if (clinic) {
      const otherDoctorIds = clinic.doctors
        .filter(d => d.status === 'active' && d.doctorId.toString() !== doctor._id.toString())
        .map(d => d.doctorId);
      
      const otherDoctors = await User.find({ _id: { $in: otherDoctorIds } });
      const allPatientIds = new Set();
      for (const od of otherDoctors) {
        if (od.patients && od.patients.length > 0) {
          od.patients.forEach(p => allPatientIds.add(p.toString()));
        }
      }
      
      // Also check appointments
      const Appointment = require('./models/Appointment');
      const clinicAppointments = await Appointment.find({ 
        clinicId: clinic._id 
      }).select('patientId doctorId');
      
      console.log(`\nAppointments with clinic ID: ${clinicAppointments.length}`);
      clinicAppointments.forEach(a => allPatientIds.add(a.patientId.toString()));
      
      console.log(`\nTotal unique patients across clinic: ${allPatientIds.size}`);
    }

    await mongoose.disconnect();
    console.log('\n✅ Done investigating');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    await mongoose.disconnect();
  }
}

fixDoctorAhmed();
