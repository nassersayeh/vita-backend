/**
 * Fix script: Connect the 3 missing users to clinic "مركز الشعب الطبي"
 * with corrected phone numbers
 * 
 * Run with: node scripts/fixMissingUsers.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.vefyn0g.mongodb.net/?appName=Cluster0')
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error(err); process.exit(1); });

const User = require('../models/User');
const Clinic = require('../models/Clinic');

const usersToFix = [
  { mobile: '0594540648', name: 'ريان', role: 'Accountant', specialty: '', staffRole: 'Accountant' },
  { mobile: '972594929543', name: 'محمد ابو رجب', role: 'Doctor', specialty: 'طبيب عام', staffRole: null },
  { mobile: '0599175526', name: 'عمر ابو كشك', role: 'Doctor', specialty: 'طبيب عام', staffRole: null },
];

async function findUser(mobile) {
  // Try exact match first
  let user = await User.findOne({ mobileNumber: mobile });
  if (user) return user;

  // Try with +972 prefix
  if (mobile.startsWith('972')) {
    user = await User.findOne({ mobileNumber: '+' + mobile });
    if (user) return user;
  }

  // Try with 0 prefix (convert 972... to 0...)
  if (mobile.startsWith('972')) {
    const alt = '0' + mobile.substring(3);
    user = await User.findOne({ mobileNumber: alt });
    if (user) return user;
  }

  // Try +970 prefix
  if (mobile.startsWith('0')) {
    const alt = '+970' + mobile.substring(1);
    user = await User.findOne({ mobileNumber: alt });
    if (user) return user;
  }

  // Try 970 prefix
  if (mobile.startsWith('0')) {
    const alt = '970' + mobile.substring(1);
    user = await User.findOne({ mobileNumber: alt });
    if (user) return user;
  }

  return null;
}

async function fix() {
  console.log('🔧 Fixing missing users...\n');

  // Find the clinic
  const clinic = await Clinic.findOne({ name: 'مركز الشعب الطبي' });
  if (!clinic) {
    console.error('❌ Clinic not found!');
    process.exit(1);
  }
  console.log(`✅ Found clinic: ${clinic.name} (ID: ${clinic._id})\n`);

  for (const entry of usersToFix) {
    console.log(`🔍 Searching for ${entry.name} (${entry.mobile})...`);
    const user = await findUser(entry.mobile);

    if (!user) {
      console.log(`  ❌ NOT FOUND with any phone format\n`);
      continue;
    }

    console.log(`  ✅ Found: ${user.fullName} (${user.mobileNumber}) - Current role: ${user.role}`);

    // Update role and specialty
    user.role = entry.role;
    if (entry.specialty) {
      user.specialty = entry.specialty;
    }
    user.activationStatus = 'active';
    await user.save({ validateBeforeSave: false });
    console.log(`  ✅ Updated role to: ${entry.role}${entry.specialty ? ', specialty: ' + entry.specialty : ''}`);

    // Add to clinic
    if (entry.role === 'Doctor') {
      // Add as doctor
      const alreadyDoctor = clinic.doctors.some(d => d.doctorId.toString() === user._id.toString());
      if (!alreadyDoctor) {
        clinic.doctors.push({ doctorId: user._id, status: 'active', joinedAt: new Date() });
        console.log(`  ✅ Added as Doctor to clinic`);
      } else {
        console.log(`  ℹ️ Already a doctor in clinic`);
      }
    } else if (entry.staffRole) {
      // Add as staff
      const alreadyStaff = clinic.staff.some(s => s.userId.toString() === user._id.toString());
      if (!alreadyStaff) {
        clinic.staff.push({ userId: user._id, role: entry.staffRole, status: 'active', addedAt: new Date() });
        console.log(`  ✅ Added as ${entry.staffRole} staff to clinic`);
      } else {
        console.log(`  ℹ️ Already staff in clinic`);
      }
    }
    console.log('');
  }

  await clinic.save();
  console.log('💾 Clinic saved successfully!');
  console.log('\n✅ Fix complete!');
  process.exit(0);
}

fix().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
