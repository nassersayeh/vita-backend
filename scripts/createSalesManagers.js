// Explicit provisioning only. Existing accounts are never reassigned or reset.
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const role = process.argv.includes('--team-lead') ? 'SalesTeamLead' : 'SalesManager';
const accounts = role === 'SalesTeamLead' ? [{ fullName: 'ابرار مجد', mobileNumber: '0597915019' }] : [
  { fullName: 'افنان نوفل', mobileNumber: '0592928619' },
  { fullName: 'يارا ابو كشك', mobileNumber: '0594583945' },
  { fullName: 'سيدرا نصير', mobileNumber: '0569538756' },
];
(async () => {
  if (!process.env.SALES_INITIAL_PASSWORD || process.env.SALES_INITIAL_PASSWORD.length < 8) throw new Error('Set SALES_INITIAL_PASSWORD');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, autoIndex: false });
  // Preflight all three before creating any account.
  for (const account of accounts) {
    const digits = account.mobileNumber.slice(1);
    const existing = await User.findOne({ mobileNumber: { $in: [account.mobileNumber, digits, `970${digits}`, `+970${digits}`, `972${digits}`, `+972${digits}`] } });
    if (existing && (existing.role !== role || existing.fullName !== account.fullName)) throw new Error(`Account conflict for ${account.fullName}; nothing reassigned`);
    account.existing = existing;
  }
  for (const account of accounts) {
    let user = account.existing;
    if (!user) user = await User.create({
      fullName: account.fullName, mobileNumber: account.mobileNumber,
      role, country: 'Palestine', activationStatus: 'active', isPhoneVerified: true,
      language: 'ar', password: await bcrypt.hash(process.env.SALES_INITIAL_PASSWORD, 12),
    });
    const verified = await User.findById(user._id);
    if (verified.role !== role || verified.activationStatus !== 'active') throw new Error('Account verification failed');
    console.log(JSON.stringify({ name: verified.fullName, mobile: verified.mobileNumber, role: verified.role, created: !account.existing }));
  }
})().catch(error => {
  // Never print connection strings or credentials from driver errors.
  console.error(error.name === 'MongoServerSelectionError' ? 'Database connection unavailable' : `Provisioning failed: ${error.message.replace(/mongodb[^\s]+/g, '[redacted]')}`);
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
