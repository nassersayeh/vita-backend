const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const { createRequire } = require('module');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const file = require.resolve('../controllers/authController');
const nativeRequire = createRequire(file);
const secret = 'isolated-unified-login-test-secret';
async function attempt({ type = 'medical_syndicate', identifier = 'medical-union', password = 'Test-password-123', active = true, insurance = false, action = 'login', extra = {} } = {}) {
  let userLookups = 0;
  const account = { _id: 'account-id', type, username: 'medical-union', phone: '0000000101', status: active ? 'active' : 'inactive', name: 'Test authority', password: await bcrypt.hash('Test-password-123', 4) };
  const match = async query => query.status === account.status && (query.username === account.username || query.phone?.$in?.includes(account.phone)) ? account : null;
  const exports = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { exports, console, Buffer, process: { env: { JWT_SECRET: secret } }, require: name => {
    if (name === '../models/User') return { findOne: async () => { userLookups++; return null; } };
    if (name === '../models/OversightAccount') return { findOne: insurance ? async () => null : match };
    if (name === '../models/InsuranceCompany') return { findOne: insurance ? match : async () => null };
    if (name === '../models/Otp' || name === '../services/whatsappService') return {};
    if (name === 'nodemailer') return { createTransport: () => ({}) };
    if (name === 'dotenv') return { config() {} };
    return nativeRequire(name);
  } });
  let status = 200; let body;
  const res = { status(value) { status = value; return this; }, json(value) { body = value; } };
  await exports[action]({ body: { mobile: identifier, password, ...extra } }, res);
  return { status, body, userLookups };
}
test('main login accepts authority usernames and directs each authority to its dashboard', async () => {
  for (const type of ['medical_syndicate', 'ministry_of_health', 'pharmacy_syndicate']) {
    const result = await attempt({ type });
    assert.equal(result.status, 200); assert.equal(result.userLookups, 0);
    assert.equal(result.body.user.role, 'oversight'); assert.equal(result.body.user.type, type);
    assert.equal(result.body.redirectTo, type === 'pharmacy_syndicate' ? '/pharmacist-union' : '/controlled-oversight');
    assert.equal(jwt.verify(result.body.token, secret).accountId, 'account-id');
  }
});
test('mobile login still checks regular users before authority accounts', async () => {
  const result = await attempt({ identifier: '0000000101' });
  assert.equal(result.status, 200); assert.equal(result.userLookups, 1);
});
test('incorrect passwords and inactive authorities cannot log in', async () => {
  assert.equal((await attempt({ password: 'incorrect' })).status, 400);
  assert.equal((await attempt({ active: false })).status, 400);
});
test('insurance usernames also use main login and retain insurance routing', async () => {
  const result = await attempt({ insurance: true });
  assert.equal(result.status, 200); assert.equal(result.body.user.role, 'insurance_company');
  assert.equal(result.body.redirectTo, '/insurance-claims');
});

test('public signup cannot create an administrator, employee or oversight identity', async () => {
  for (const role of ['Admin', 'Superadmin', 'Employee', 'oversight', 'ministry_of_health', 'medical_syndicate']) {
    const result = await attempt({ action: 'signup', extra: { role } });
    assert.equal(result.status, 403); assert.equal(result.userLookups, 0);
  }
});
