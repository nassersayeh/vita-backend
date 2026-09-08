require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const oldCenter = await User.findOne({ role: 'Radiology', $and: [{ fullName: /مركز البرج للأشعة/i }, { fullName: { $not: /البلد/i } }] });
  if (!oldCenter) throw new Error('The existing Al Burj center account was not found.');
  oldCenter.address = 'نابلس - رفيديا - برج رفيديا';
  oldCenter.city = 'Nablus';
  await oldCenter.save({ validateBeforeSave: false });

  const mobileNumber = '0569488554';
  let branch = await User.findOne({ $or: [{ mobileNumber }, { role: 'Radiology', fullName: 'مركز البرج "التاج"' }] }).select('+passwordChangedAt');
  if (branch && branch.role !== 'Radiology') {
    throw new Error('The requested mobile number already belongs to another account.');
  }
  const password = await bcrypt.hash('123456789', 12);
  if (!branch) branch = new User({
    fullName: 'مركز البرج "التاج"', mobileNumber, password, role: 'Radiology',
    country: 'Palestine', city: 'Nablus', address: 'نابلس - شارع سفيان - عمارة الطحان',
    activationStatus: 'active', isPhoneVerified: true, isPaid: true,
  });
  else {
    branch.fullName = 'مركز البرج "التاج"'; branch.mobileNumber = mobileNumber; branch.password = password;
    branch.country = 'Palestine'; branch.city = 'Nablus'; branch.address = 'نابلس - شارع سفيان - عمارة الطحان';
    branch.activationStatus = 'active'; branch.isPhoneVerified = true;
  }
  await branch.save({ validateBeforeSave: false });
  console.log(JSON.stringify({ oldCenter: { id: oldCenter._id, address: oldCenter.address }, newBranch: { id: branch._id, name: branch.fullName, mobileNumber: branch.mobileNumber, address: branch.address } }, null, 2));
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
