const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Clinic = require('./models/Clinic');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function createDoctorAhmed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Step 1: Find clinic "مركز الشعب"
    const clinic = await Clinic.findOne({ name: { $regex: /الشعب/i } });
    if (!clinic) {
      // Try finding by listing all clinics
      const allClinics = await Clinic.find({});
      console.log('All clinics:');
      for (const c of allClinics) {
        const owner = await User.findById(c.ownerId);
        console.log(`  - Clinic: "${c.name}" | Owner: ${owner ? owner.fullName : 'N/A'} | ID: ${c._id}`);
      }
      
      // Also search in users with role Clinic
      const clinicUsers = await User.find({ role: 'Clinic' });
      console.log('\nClinic users:');
      for (const u of clinicUsers) {
        console.log(`  - "${u.fullName}" | Mobile: ${u.mobileNumber} | ID: ${u._id}`);
      }
      
      console.log('\n❌ Could not find clinic "مركز الشعب". Please check the name.');
      await mongoose.disconnect();
      return;
    }

    console.log(`✅ Found clinic: "${clinic.name}" (ID: ${clinic._id})`);

    // Step 2: Check if doctor already exists
    const existingDoctor = await User.findOne({ mobileNumber: '0598491649' });
    if (existingDoctor) {
      console.log(`⚠️ Doctor with phone 0598491649 already exists: ${existingDoctor.fullName} (ID: ${existingDoctor._id})`);
      await mongoose.disconnect();
      return;
    }

    // Step 3: Create the doctor account
    const hashedPassword = await bcrypt.hash('123456789', 10);
    
    // Schedule: 9 AM to 12 AM (midnight) every day
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const schedule = days.map(day => ({
      day,
      timeSlots: [{ start: '09:00', end: '00:00' }]
    }));

    const doctor = new User({
      fullName: 'احمد عدوي',
      mobileNumber: '0598491649',
      password: hashedPassword,
      email: `ahmed.adawi.${Date.now()}@vita.ps`,
      role: 'Doctor',
      country: 'Palestine',
      city: 'غزة',
      idNumber: `DOC${Date.now()}`,
      address: 'غزة',
      sex: 'Male',
      activationStatus: 'active',
      isPaid: true,
      isPhoneVerified: true,
      workingSchedule: schedule,
      managedByClinic: true,
      clinicId: clinic._id,
      specialty: 'طبيب عام',
    });

    await doctor.save();
    console.log(`✅ Doctor created: "${doctor.fullName}" (ID: ${doctor._id})`);

    // Step 4: Add doctor to clinic
    await clinic.addDoctor(doctor._id);
    console.log(`✅ Doctor added to clinic "${clinic.name}"`);

    console.log('\n========== Summary ==========');
    console.log(`Name: احمد عدوي`);
    console.log(`Phone: 0598491649`);
    console.log(`Password: 123456789`);
    console.log(`Role: Doctor`);
    console.log(`Clinic: ${clinic.name}`);
    console.log(`Schedule: 09:00 AM - 12:00 AM (midnight) every day`);
    console.log('==============================');

    await mongoose.disconnect();
    console.log('\n✅ Done!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    await mongoose.disconnect();
  }
}

createDoctorAhmed();
