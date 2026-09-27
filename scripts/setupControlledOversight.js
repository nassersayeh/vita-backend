// Creates missing oversight accounts only; never replaces existing credentials.
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { randomBytes } = require('crypto');
const fs = require('fs');
const Oversight = require('../models/OversightAccount');
const User = require('../models/User');
async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false });
  const receipts = [];
  const credentialsPath = '/private/tmp/vita-controlled-accounts.json';
  const previous = fs.existsSync(credentialsPath) ? JSON.parse(fs.readFileSync(credentialsPath, 'utf8')) : [];
  try {
    for (const spec of [
      { type: 'medical_syndicate', name: 'Palestinian Medical Syndicate', nameAr: 'نقابة الأطباء الفلسطينية', username: 'medical-union', phone: '0000000101', email: 'medical-union@vita.invalid' },
      { type: 'ministry_of_health', name: 'Palestinian Ministry of Health', nameAr: 'وزارة الصحة الفلسطينية', username: 'health-ministry', phone: '0000000102', email: 'health-ministry@vita.invalid' },
    ]) {
      const existing = await Oversight.findOne({ type: spec.type }).select('username phone status password');
      if (existing) {
        const saved = previous.find(item => item.type === spec.type && item.username === existing.username);
        const retainedPassword = saved?.password && await bcrypt.compare(saved.password, existing.password) ? saved.password : undefined;
        receipts.push({ type: spec.type, status: 'existing_unchanged', username: existing.username, phone: existing.phone, ...(retainedPassword ? { password: retainedPassword } : {}) });
        continue;
      }
      if (await User.exists({ mobileNumber: spec.phone }) || await Oversight.exists({ $or: [{ phone: spec.phone }, { username: spec.username }, { email: spec.email }] })) throw new Error('Placeholder account identifiers are already in use');
      const password = `Vita-${randomBytes(12).toString('base64url')}`;
      await Oversight.create({ ...spec, password: await bcrypt.hash(password, 12), notes: 'Controlled prescription oversight. Contact details are placeholders pending replacement by the account administrator.' });
      receipts.push({ type: spec.type, status: 'created', username: spec.username, phone: spec.phone, password, contactDetailsArePlaceholders: true });
      fs.writeFileSync('/private/tmp/vita-controlled-accounts.json', JSON.stringify(receipts, null, 2), { mode: 0o600 });
    }
    fs.writeFileSync('/private/tmp/vita-controlled-accounts.json', JSON.stringify(receipts, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(receipts.map(({ password, ...receipt }) => ({ ...receipt, credentialsFile: '/private/tmp/vita-controlled-accounts.json', hasNewPassword: Boolean(password) }))));
  } finally { await mongoose.disconnect(); }
}
main().catch(error => { console.error('Oversight setup failed:', error.name, error.code || ''); process.exitCode = 1; });
