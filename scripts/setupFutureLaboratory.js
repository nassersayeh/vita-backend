require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Service = require('../models/LaboratoryService');
const catalog = require('./futureLaboratoryCatalog.json');
const { getMobileCandidates } = require('../utils/mobileNumber');
async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  let lab = await User.findOne({ mobileNumber: { $in: getMobileCandidates('0595223119') } });
  if (lab && (lab.role !== 'Lab' || lab.fullName !== 'مختبر المستقبل' || lab.clinicId)) throw new Error('Phone belongs to another account; no changes made.');
  if (!lab) lab = await User.create({ fullName: 'مختبر المستقبل', mobileNumber: '0595223119', password: await bcrypt.hash('123456789', 12), role: 'Lab', country: 'Palestine', city: 'نابلس', address: 'نابلس - وسط البلد عمارة فريتخ', activationStatus: 'active', isPhoneVerified: true, isPublic: true });
  for (const service of catalog) await Service.updateOne({ laboratoryId: lab._id, name: service.name }, { $setOnInsert: service }, { upsert: true, runValidators: true });
  console.log(JSON.stringify({ laboratoryId: lab._id, fullName: lab.fullName, catalogCount: catalog.length }));
}
run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
