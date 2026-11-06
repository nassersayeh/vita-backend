require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Service = require('../models/LaboratoryService');
const { getMobileCandidates } = require('../utils/mobileNumber');
const catalog = require('./shakhshirLaboratoryCatalog.json');

const profile = {
  fullName: 'مختبر الشخشير',
  mobileNumber: '0598809429',
  role: 'Lab',
  country: 'Palestine',
  city: 'نابلس',
  address: 'نابلس شارع سفيان عمارة التيتي ط 5',
  activationStatus: 'active',
  isPhoneVerified: true,
  isPublic: true,
  language: 'ar',
};

async function run() {
  if (catalog.length !== 128 || new Set(catalog.map(s => s.name)).size !== catalog.length) throw new Error('Invalid catalog.');
  for (const service of catalog) await new Service({ ...service, laboratoryId: new mongoose.Types.ObjectId() }).validate();
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
  const matches = await User.find({ $or: [
    { mobileNumber: { $in: getMobileCandidates(profile.mobileNumber) } },
    { fullName: profile.fullName },
  ] });
  if (matches.length > 1 || (matches.length && (
    matches[0].mobileNumber !== profile.mobileNumber || matches[0].fullName !== profile.fullName ||
    matches[0].role !== 'Lab' || matches[0].clinicId
  ))) throw new Error('Conflicting account exists; no changes made.');
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'preview', profile, catalogCount: catalog.length, existingAccount: matches.length > 0 }));
    return;
  }
  const password = process.env.LAB_SETUP_PASSWORD;
  if (!password) throw new Error('LAB_SETUP_PASSWORD is required.');
  if (matches.length && !await bcrypt.compare(password, matches[0].password)) throw new Error('Existing credentials differ; no changes made.');
  // This deployment uses standalone MongoDB. Preflight all conflicts, then use
  // insert-only upserts so interrupted runs can safely resume.
  let account = matches[0];
  if (account) {
    for (const [key, value] of Object.entries(profile)) if (account[key] !== value) throw new Error('Existing profile differs: ' + key);
    const existing = await Service.find({ laboratoryId: account._id }).lean();
    for (const item of existing) {
      const expected = catalog.find(s => s.name === item.name);
      if (!expected || item.price !== expected.price || !item.isActive) throw new Error('Existing service differs; no changes made.');
    }
  }
  if (!account) account = await User.create({ ...profile, password: await bcrypt.hash(password, 12) });
  const labId = account._id;
  await Service.bulkWrite(catalog.map(service => ({ updateOne: {
    filter: { laboratoryId: labId, name: service.name },
    update: { $setOnInsert: { ...service, laboratoryId: labId, isActive: true } },
    upsert: true,
  } })));
  const lab = await User.findById(labId);
  const services = await Service.find({ laboratoryId: labId }).lean();
  const prices = new Map(services.map(s => [s.name, s]));
  for (const [key, value] of Object.entries(profile)) if (lab[key] !== value) throw new Error('Profile verification failed: ' + key);
  if (!await bcrypt.compare(password, lab.password)) throw new Error('Password verification failed.');
  if (services.length !== catalog.length || catalog.some(s => prices.get(s.name)?.price !== s.price || !prices.get(s.name)?.isActive)) throw new Error('Catalog verification failed.');
  console.log(JSON.stringify({ verified: true, laboratoryId: labId, fullName: lab.fullName, mobileNumber: lab.mobileNumber, address: lab.address, catalogCount: services.length }));
}

run().catch(error => {
  console.error(error.name + ': ' + error.message);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
