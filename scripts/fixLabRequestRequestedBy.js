/**
 * Script: Fix LabRequest requestedBy for "مركز الشعب" clinic
 * 
 * Sets requestedBy to the accountant for all lab requests in this clinic
 * that don't already have requestedBy set.
 */

const mongoose = require('mongoose');

const MONGO_URI = 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const Clinic = require('../models/Clinic');
  const User = require('../models/User');
  const LabRequest = require('../models/LabRequest');

  // Find "مركز الشعب" clinic
  const clinic = await Clinic.findOne({ name: /الشعب/i });
  if (!clinic) {
    // Try finding by searching all clinics
    const allClinics = await Clinic.find({}).select('name ownerId');
    console.log('All clinics:');
    for (const c of allClinics) {
      const owner = await User.findById(c.ownerId).select('fullName');
      console.log(`  - ${c.name} (owner: ${owner?.fullName}) [ID: ${c._id}]`);
    }
    console.log('\n❌ Could not find clinic with name containing "الشعب"');
    await mongoose.connection.close();
    return;
  }

  console.log(`\n📋 Clinic found: "${clinic.name}" [ID: ${clinic._id}]`);
  console.log(`   Owner: ${clinic.ownerId}`);

  // Find the accountant staff member
  const accountantStaff = clinic.staff.find(s => s.role === 'Accountant' && s.status === 'active');
  if (!accountantStaff) {
    console.log('\n❌ No active accountant found in this clinic');
    console.log('Staff:', clinic.staff.map(s => ({ userId: s.userId, role: s.role, status: s.status })));
    await mongoose.connection.close();
    return;
  }

  const accountant = await User.findById(accountantStaff.userId).select('fullName role');
  console.log(`👤 Accountant: ${accountant?.fullName} [ID: ${accountantStaff.userId}]`);

  // Get all doctor IDs in this clinic
  const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
  console.log(`👨‍⚕️ Active doctors: ${doctorIds.length}`);

  // Find all lab requests for this clinic's doctors
  const labRequests = await LabRequest.find({
    $or: [
      { clinicId: clinic._id },
      { doctorId: { $in: doctorIds } }
    ]
  });

  console.log(`\n🔬 Total lab requests found: ${labRequests.length}`);

  let updated = 0;
  let alreadySet = 0;

  for (const lr of labRequests) {
    if (lr.requestedBy && lr.requestedBy.toString() === accountantStaff.userId.toString()) {
      alreadySet++;
      continue;
    }

    lr.requestedBy = accountantStaff.userId;
    await lr.save();
    updated++;
  }

  console.log(`\n✅ Updated: ${updated} lab requests (requestedBy → accountant)`);
  console.log(`⏭️  Already set: ${alreadySet}`);
  console.log(`📊 Total processed: ${labRequests.length}`);

  await mongoose.connection.close();
  console.log('\n🔌 Connection closed. Done!');
}

run().catch(err => {
  console.error('❌ Error:', err);
  mongoose.connection.close();
  process.exit(1);
});
