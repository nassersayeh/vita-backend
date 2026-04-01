/**
 * Script: Set "مركز الشعب الطبي" as a workplace for all clinic doctors
 * Working hours: 9:00 AM - 4:00 PM, Sunday through Thursday
 * 
 * Run with: node scripts/setDoctorWorkplaces.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.vefyn0g.mongodb.net/?appName=Cluster0')
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error(err); process.exit(1); });

const User = require('../models/User');
const Clinic = require('../models/Clinic');

const CLINIC_NAME = 'مركز الشعب الطبي';
const CLINIC_ADDRESS = 'الشعب - فلسطين';

// Sunday to Thursday, 9 AM - 4 PM
const workSchedule = [
  { day: 'Sunday', timeSlots: [{ start: '09:00', end: '16:00' }] },
  { day: 'Monday', timeSlots: [{ start: '09:00', end: '16:00' }] },
  { day: 'Tuesday', timeSlots: [{ start: '09:00', end: '16:00' }] },
  { day: 'Wednesday', timeSlots: [{ start: '09:00', end: '16:00' }] },
  { day: 'Thursday', timeSlots: [{ start: '09:00', end: '16:00' }] },
];

async function run() {
  console.log('🏥 Setting workplaces for clinic doctors...\n');

  const clinic = await Clinic.findOne({ name: CLINIC_NAME });
  if (!clinic) {
    console.error('❌ Clinic not found!');
    process.exit(1);
  }

  console.log(`✅ Found clinic: ${clinic.name}\n`);

  const doctorIds = clinic.doctors
    .filter(d => d.status === 'active')
    .map(d => d.doctorId);

  const doctors = await User.find({ _id: { $in: doctorIds } });

  for (const doctor of doctors) {
    console.log(`👨‍⚕️ ${doctor.fullName} (${doctor.mobileNumber})`);

    // Check if this workplace already exists
    const existingIndex = doctor.workplaces.findIndex(
      wp => wp.name === CLINIC_NAME
    );

    const workplace = {
      name: CLINIC_NAME,
      address: CLINIC_ADDRESS,
      schedule: workSchedule,
      isActive: true,
    };

    if (existingIndex >= 0) {
      // Update existing workplace
      doctor.workplaces[existingIndex] = workplace;
      console.log('   🔄 Updated existing workplace');
    } else {
      // Add new workplace
      doctor.workplaces.push(workplace);
      console.log('   ➕ Added new workplace');
    }

    // Also set the global workingSchedule if empty
    if (!doctor.workingSchedule || doctor.workingSchedule.length === 0) {
      doctor.workingSchedule = workSchedule;
      console.log('   📅 Set global working schedule');
    }

    await doctor.save({ validateBeforeSave: false });
    console.log('   ✅ Saved\n');
  }

  console.log(`\n🎉 Done! Updated ${doctors.length} doctors with workplace "${CLINIC_NAME}" (9:00 AM - 4:00 PM, Sun-Thu)`);
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
