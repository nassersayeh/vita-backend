/**
 * Migration Script: Update existing users' roles/specialties and create clinic "مركز الشعب الطبي"
 * 
 * Run with: node scripts/migrateClinicRoles.js
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.vefyn0g.mongodb.net/?appName=Cluster0')
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error(err); process.exit(1); });

const User = require('../models/User');
const Clinic = require('../models/Clinic');

// Role and specialty mappings
const userUpdates = [
  { mobile: '0593274299', name: 'نور قنيري', role: 'Nurse', specialty: '' },
  { mobile: '0569156627', name: 'شذى حجاب', role: 'Nurse', specialty: '' },
  { mobile: '0594642997', name: 'يافا حجاب', role: 'LabTech', specialty: 'طب مخبري' },
  { mobile: '0598413681', name: 'لمى سروجي', role: 'LabTech', specialty: 'طب مخبري' },
  { mobile: '0594540647', name: 'ريان صايغ', role: 'Accountant', specialty: '' },
  { mobile: '0568870030', name: 'طه التك', role: 'Accountant', specialty: '' },
  { mobile: '0569826707', name: 'احمد حنون', role: 'Doctor', specialty: 'طبيب اسنان' },
  { mobile: '0594417681', name: 'علاء ابو كشك', role: 'Doctor', specialty: 'طبيب اسنان' },
  { mobile: '0598371022', name: 'مجد اسعد', role: 'Doctor', specialty: 'طبيب اسنان' },
  { mobile: '0598491649', name: 'احمد عدوي', role: 'Doctor', specialty: 'طبيب عام' },
  { mobile: '0594929543', name: 'محمود ابو رجب', role: 'Doctor', specialty: 'طبيب عام' },
  { mobile: '0599175523', name: 'عمر ابو كشك', role: 'Doctor', specialty: 'طبيب عام' },
];

async function migrate() {
  console.log('🚀 Starting migration...\n');

  // Step 1: Update users' roles and specialties
  const updatedUsers = [];
  for (const update of userUpdates) {
    // Try to find by mobile number with various formats
    let user = await User.findOne({ mobileNumber: update.mobile });
    if (!user) {
      // Try with +970 prefix (Palestinian format)
      const altMobile = '+970' + update.mobile.substring(1);
      user = await User.findOne({ mobileNumber: altMobile });
    }
    if (!user) {
      // Try with 970 prefix
      const altMobile = '970' + update.mobile.substring(1);
      user = await User.findOne({ mobileNumber: altMobile });
    }
    if (!user) {
      console.log(`⚠️  User not found: ${update.name} (${update.mobile})`);
      continue;
    }

    const oldRole = user.role;
    user.role = update.role;
    if (update.specialty) {
      user.specialty = update.specialty;
    }
    user.activationStatus = 'active';
    user.isPaid = true;
    user.isPhoneVerified = true;

    await user.save({ validateBeforeSave: false });
    updatedUsers.push({ user, update });
    console.log(`✅ Updated ${update.name}: ${oldRole} → ${update.role}${update.specialty ? ' (' + update.specialty + ')' : ''}`);
  }

  // Step 2: Create clinic owner account "مركز الشعب الطبي"
  console.log('\n📋 Creating clinic account...');
  
  let clinicOwner = await User.findOne({ mobileNumber: '0500000001' }); // Placeholder for clinic
  if (!clinicOwner) {
    const hashedPassword = await bcrypt.hash('clinic123', 10);
    clinicOwner = new User({
      fullName: 'مركز الشعب الطبي',
      mobileNumber: '0500000001',
      email: 'alshaab.clinic@vita.ps',
      password: hashedPassword,
      role: 'Clinic',
      country: 'Palestine',
      city: 'القدس',
      address: 'فلسطين',
      idNumber: `CLINIC-ALSHAAB-${Date.now()}`,
      isPhoneVerified: true,
      activationStatus: 'active',
      isPaid: true,
    });
    await clinicOwner.save();
    console.log(`✅ Created clinic owner: مركز الشعب الطبي (mobile: 0500000001, password: clinic123)`);
  } else {
    console.log(`ℹ️  Clinic owner already exists: ${clinicOwner.fullName}`);
  }

  // Step 3: Create or update Clinic document
  let clinic = await Clinic.findOne({ ownerId: clinicOwner._id });
  if (!clinic) {
    clinic = new Clinic({
      ownerId: clinicOwner._id,
      name: 'مركز الشعب الطبي',
      description: 'مركز الشعب الطبي - خدمات طبية متكاملة',
      maxDoctors: 10,
      doctors: [],
      staff: [],
      settings: {
        allowDoctorFinancialView: true,
        allowDoctorPatientView: true,
        allowDoctorScheduleEdit: true,
        autoApproveAppointments: false
      }
    });
  }

  // Step 4: Add doctors and staff to the clinic
  for (const { user, update } of updatedUsers) {
    if (update.role === 'Doctor') {
      // Add as doctor
      const existingDoctor = clinic.doctors.find(d => d.doctorId.toString() === user._id.toString());
      if (!existingDoctor) {
        clinic.doctors.push({
          doctorId: user._id,
          status: 'active',
          notes: update.specialty
        });
        console.log(`  + Added doctor: ${update.name} (${update.specialty})`);
      } else {
        existingDoctor.status = 'active';
        console.log(`  ~ Doctor already in clinic: ${update.name}`);
      }
    } else {
      // Add as staff
      const existingStaff = clinic.staff.find(s => s.userId.toString() === user._id.toString());
      if (!existingStaff) {
        clinic.staff.push({
          userId: user._id,
          role: update.role,
          status: 'active',
          notes: update.specialty || update.role
        });
        console.log(`  + Added staff: ${update.name} (${update.role})`);
      } else {
        existingStaff.status = 'active';
        existingStaff.role = update.role;
        console.log(`  ~ Staff already in clinic: ${update.name}`);
      }
    }
  }

  await clinic.save();
  console.log(`\n✅ Clinic "${clinic.name}" saved with ${clinic.doctors.length} doctors and ${clinic.staff.length} staff members`);

  // Step 5: Summary
  console.log('\n📊 Migration Summary:');
  console.log(`  Total users updated: ${updatedUsers.length}`);
  console.log(`  Doctors: ${updatedUsers.filter(u => u.update.role === 'Doctor').length}`);
  console.log(`  Nurses: ${updatedUsers.filter(u => u.update.role === 'Nurse').length}`);
  console.log(`  Accountants: ${updatedUsers.filter(u => u.update.role === 'Accountant').length}`);
  console.log(`  Lab Techs: ${updatedUsers.filter(u => u.update.role === 'LabTech').length}`);
  console.log(`  Clinic: مركز الشعب الطبي (owner: ${clinicOwner._id})`);
  console.log(`\n🎉 Migration completed successfully!`);
  
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
