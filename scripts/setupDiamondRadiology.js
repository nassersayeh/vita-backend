require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const crypto = require('crypto');
const fs = require('fs');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const MedicalTest = require('../models/MedicalTest');
const mobileNumber = '0598588999';
const fullName = 'مركز ديموند للأشعة لتصوير الأسنان والفكين';
const services = [
  ['Panoramic X-Ray', 'X-RAY'], ['T.M.J X-Ray', 'X-RAY'], ['Bite Wing X-Ray', 'X-RAY'], ['Others X-Ray', 'X-RAY'],
  ['Partial CBCT', 'CBCT'], ['Mandibular CBCT', 'CBCT'], ['Maxilla CBCT', 'CBCT'], ['Full Mouth CBCT', 'CBCT'],
  ['Impacted Tooth CBCT', 'CBCT'], ['T.M.J CBCT', 'CBCT'], ['Sinuses CBCT', 'CBCT'], ['3D Reconstruction CBCT', 'CBCT'],
];
async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 7000 });
  let center = await User.findOne({ mobileNumber: { $in: [mobileNumber, '598588999', '+970598588999', '970598588999'] } });
  if (center && (center.role !== 'Radiology' || center.fullName !== fullName)) throw new Error('Mobile number belongs to another account; no changes made.');
  let password;
  if (!center) {
    password = `Vita-${crypto.randomBytes(12).toString('base64url')}`;
    // Save credentials privately before creating the account so a subsequent failure cannot lose them.
    fs.writeFileSync('/private/tmp/vita-diamond-account.json', JSON.stringify({ fullName, mobileNumber, password }, null, 2), { mode: 0o600, flag: 'wx' });
    center = await User.create({ fullName, mobileNumber, password: await bcrypt.hash(password, 12), role: 'Radiology', country: 'Palestine', city: 'Nablus', address: 'نابلس - شارع سفيان - عمارة مجمع البساتين', description: 'مركز ديموند للأشعة لتصوير الأسنان والفكين — أخصائي الأشعة الدكتور جمال صوفان', activationStatus: 'active', isPublic: true, isPaid: true });
  }
  for (const [name, category] of services) {
    await MedicalTest.updateOne({ providerId: center._id, name }, { $setOnInsert: { type: 'radiology', category, price: 0, isActive: true, createdBy: center._id, description: name === 'Others X-Ray' ? 'أشعة أخرى حسب طلب الطبيب' : '' } }, { upsert: true, runValidators: true });
  }
  const saved = await MedicalTest.find({ providerId: center._id }).select('name category price isActive').lean();
  if (!services.every(([name]) => saved.some(service => service.name === name && service.isActive))) throw new Error('Service verification failed.');
  console.log(JSON.stringify({ name: center.fullName, mobileNumber: center.mobileNumber, city: center.city, address: center.address, status: center.activationStatus, services: saved.map(({name, category, price}) => ({name, category, price})), credentialsFile: password ? '/private/tmp/vita-diamond-account.json' : 'Existing password preserved' }, null, 2));
}
run().catch(error => { console.error(error.name === 'MongooseServerSelectionError' ? 'Database connection unavailable.' : error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
