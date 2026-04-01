/**
 * Script: Create a test clinic with 1 doctor, 1 nurse, 1 accountant, 1 lab tech
 * All passwords: 123456789
 * 
 * Run with: node scripts/createTestClinic.js
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.vefyn0g.mongodb.net/?appName=Cluster0')
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error(err); process.exit(1); });

const User = require('../models/User');
const Clinic = require('../models/Clinic');

const PASSWORD = '123456789';

const USERS_TO_CREATE = [
  {
    fullName: 'عيادة الاختبار',
    mobileNumber: '0500000099',
    email: 'test.clinic@vita.ps',
    role: 'Clinic',
    specialization: 'إدارة عيادة',
    address: 'فلسطين',
    city: 'نابلس',
    country: 'فلسطين',
    idNumber: '000000099',
    label: 'Clinic Owner'
  },
  {
    fullName: 'د. سامي الاختبار',
    mobileNumber: '0590000001',
    email: 'test.doctor@vita.ps',
    role: 'Doctor',
    specialization: 'طب عام',
    address: 'فلسطين',
    city: 'نابلس',
    country: 'فلسطين',
    idNumber: '000000001',
    label: 'Doctor'
  },
  {
    fullName: 'نورا الممرضة',
    mobileNumber: '0590000002',
    email: 'test.nurse@vita.ps',
    role: 'Nurse',
    specialization: 'تمريض',
    address: 'فلسطين',
    city: 'نابلس',
    country: 'فلسطين',
    idNumber: '000000002',
    label: 'Nurse'
  },
  {
    fullName: 'خالد المحاسب',
    mobileNumber: '0590000003',
    email: 'test.accountant@vita.ps',
    role: 'Accountant',
    specialization: 'محاسبة',
    address: 'فلسطين',
    city: 'نابلس',
    country: 'فلسطين',
    idNumber: '000000003',
    label: 'Accountant'
  },
  {
    fullName: 'ليلى فني المختبر',
    mobileNumber: '0590000004',
    email: 'test.labtech@vita.ps',
    role: 'LabTech',
    specialization: 'مختبرات',
    address: 'فلسطين',
    city: 'نابلس',
    country: 'فلسطين',
    idNumber: '000000004',
    label: 'Lab Tech'
  }
];

async function run() {
  console.log('🏥 Creating Test Clinic with full staff...\n');
  console.log('═'.repeat(60));

  const hashedPassword = await bcrypt.hash(PASSWORD, 10);
  const createdUsers = {};

  for (const userData of USERS_TO_CREATE) {
    // Check if user already exists
    let user = await User.findOne({ mobileNumber: userData.mobileNumber });
    
    if (user) {
      console.log(`⚠️  ${userData.label} already exists: ${user.fullName} (${user.mobileNumber})`);
      // Update password to ensure it's correct
      user.password = hashedPassword;
      await user.save({ validateBeforeSave: false });
    } else {
      user = await User.create({
        fullName: userData.fullName,
        mobileNumber: userData.mobileNumber,
        email: userData.email,
        password: hashedPassword,
        role: userData.role,
        specialization: userData.specialization || undefined,
        address: userData.address,
        city: userData.city,
        country: userData.country,
        idNumber: userData.idNumber,
        isActive: true,
        isVerified: true,
      });
      console.log(`✅ Created ${userData.label}: ${user.fullName}`);
    }
    
    createdUsers[userData.role] = user;
  }

  console.log('\n' + '═'.repeat(60));
  console.log('📋 Setting up clinic...\n');

  const clinicOwner = createdUsers['Clinic'];
  const doctor = createdUsers['Doctor'];
  const nurse = createdUsers['Nurse'];
  const accountant = createdUsers['Accountant'];
  const labTech = createdUsers['LabTech'];

  // Check if clinic already exists
  let clinic = await Clinic.findOne({ ownerId: clinicOwner._id });
  
  if (clinic) {
    console.log(`⚠️  Clinic already exists: ${clinic.name}`);
  } else {
    clinic = await Clinic.create({
      ownerId: clinicOwner._id,
      name: 'عيادة الاختبار',
      description: 'عيادة اختبار للتجربة',
      maxDoctors: 10,
      doctors: [
        { doctorId: doctor._id, status: 'active', notes: 'طبيب عام' }
      ],
      staff: [
        { userId: nurse._id, role: 'Nurse', status: 'active' },
        { userId: accountant._id, role: 'Accountant', status: 'active' },
        { userId: labTech._id, role: 'LabTech', status: 'active' },
      ],
      settings: {
        autoApproveAppointments: false,
        allowDoctorFinancialView: true,
        allowDoctorPatientView: true,
        allowDoctorScheduleEdit: true,
      },
      isActive: true
    });
    console.log(`✅ Clinic created: ${clinic.name}`);
  }

  // Set doctor as clinic-managed
  doctor.managedByClinic = true;
  doctor.clinicId = clinic._id;
  doctor.workplaces = [{
    name: 'عيادة الاختبار',
    address: 'فلسطين',
    workingHours: [
      { day: 'Sunday', slots: [{ start: '09:00', end: '16:00' }] },
      { day: 'Monday', slots: [{ start: '09:00', end: '16:00' }] },
      { day: 'Tuesday', slots: [{ start: '09:00', end: '16:00' }] },
      { day: 'Wednesday', slots: [{ start: '09:00', end: '16:00' }] },
      { day: 'Thursday', slots: [{ start: '09:00', end: '16:00' }] },
    ]
  }];
  await doctor.save({ validateBeforeSave: false });
  console.log(`✅ Doctor set as clinic-managed with working hours`);

  // Set clinicId on staff members
  nurse.clinicId = clinic._id;
  await nurse.save({ validateBeforeSave: false });
  
  accountant.clinicId = clinic._id;
  await accountant.save({ validateBeforeSave: false });
  
  labTech.clinicId = clinic._id;
  await labTech.save({ validateBeforeSave: false });
  console.log(`✅ Staff members linked to clinic`);

  // Print credentials
  console.log('\n' + '═'.repeat(60));
  console.log('🔑 LOGIN CREDENTIALS (Password for all: 123456789)');
  console.log('═'.repeat(60));
  console.log('');
  console.log('┌─────────────────┬────────────────────┬──────────────┐');
  console.log('│ Role            │ Name               │ Mobile       │');
  console.log('├─────────────────┼────────────────────┼──────────────┤');
  console.log(`│ 🏥 Clinic Owner │ عيادة الاختبار      │ 0500000099   │`);
  console.log(`│ 👨‍⚕️ Doctor       │ د. سامي الاختبار    │ 0590000001   │`);
  console.log(`│ 👩‍⚕️ Nurse        │ نورا الممرضة        │ 0590000002   │`);
  console.log(`│ 💰 Accountant   │ خالد المحاسب        │ 0590000003   │`);
  console.log(`│ 🔬 Lab Tech     │ ليلى فني المختبر    │ 0590000004   │`);
  console.log('└─────────────────┴────────────────────┴──────────────┘');
  console.log('');
  console.log('🔒 Password for ALL accounts: 123456789');
  console.log('');
  console.log('═'.repeat(60));
  
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
