const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const vm = require('vm');
const fs = require('fs');
const code = fs.readFileSync(require.resolve('../middleware/controlledAuth'), 'utf8');
const secret = 'isolated-test-secret-not-used-by-the-application';
async function run(payload, { user = null, account = null, invalidSignature = false, tokenOptions = {} } = {}) {
  const moduleObject = { exports: {} };
  vm.runInNewContext(code, { module: moduleObject, process: { env: { JWT_SECRET: secret } }, require: name => name === 'jsonwebtoken' ? jwt : name.endsWith('/User') ? { findById: () => ({ select: async () => user }) } : { findOne: () => ({ select: async () => account }) } });
  const token = jwt.sign(payload, invalidSignature ? 'wrong-secret' : secret, { expiresIn: '1h', ...tokenOptions });
  const req = { headers: { authorization: `Bearer ${token}` } };
  let status; let next = false;
  const res = { status(value) { status = value; return this; }, json() {} };
  await moduleObject.exports(req, res, () => { next = true; });
  return { status, next, actor: req.controlledActor };
}
test('oversight authority is loaded from database rather than trusting a supplied token type', async () => {
  const result = await run({ role: 'oversight', accountId: 'account', type: 'ministry_of_health' }, { account: { _id: 'account', type: 'pharmacy_syndicate' } });
  assert.equal(result.next, true); assert.equal(result.actor.role, 'pharmacy_syndicate');
});
test('invalid signature, deleted/inactive account and disabled user fail authentication', async () => {
  assert.equal((await run({ role: 'oversight', accountId: 'account' })).status, 401);
  assert.equal((await run({ userId: 'user' }, { user: { role: 'Doctor', activationStatus: 'pending' } })).status, 401);
  assert.equal((await run({ userId: 'user' }, { invalidSignature: true })).status, 401);
});
test('password change invalidates older user sessions', async () => {
  assert.equal((await run({ userId: 'user' }, { user: { _id: 'user', role: 'Doctor', activationStatus: 'active', passwordChangedAt: new Date(Date.now() + 1000) } })).status, 401);
});

test('controlled access rejects expired, overly old, unissued, future and wrong-algorithm tokens', async () => {
  const account = { _id: 'account', type: 'ministry_of_health' };
  const payload = { role: 'oversight', accountId: 'account' };
  for (const [extra, tokenOptions] of [
    [{ iat: Math.floor(Date.now() / 1000) - 3601 }, { expiresIn: '7d' }],
    [{}, { expiresIn: -1 }], [{}, { noTimestamp: true }],
    [{ iat: Math.floor(Date.now() / 1000) + 60 }, {}], [{}, { algorithm: 'HS384' }],
  ]) assert.equal((await run({ ...payload, ...extra }, { account, tokenOptions })).status, 401);
});
test('oversight password changes and server logout invalidate old tokens', async () => {
  const payload = { role: 'oversight', accountId: 'account', sessionVersion: 2 };
  assert.equal((await run(payload, { account: { _id: 'account', type: 'ministry_of_health', sessionVersion: 3 } })).status, 401);
  assert.equal((await run(payload, { account: { _id: 'account', type: 'ministry_of_health', sessionVersion: 2, passwordChangedAt: new Date(Date.now() + 1000) } })).status, 401);
  assert.equal((await run(payload, { account: { _id: 'account', type: 'ministry_of_health', sessionVersion: 2 } })).next, true);
});
test('regular doctor token roles are never used to elevate database authority', async () => {
  const result = await run({ userId: 'doctor', role: 'Superadmin' }, { user: { _id: 'doctor', role: 'Doctor', activationStatus: 'active' } });
  assert.equal(result.next, true); assert.equal(result.actor.role, 'Doctor');
  assert.equal((await run({ userId: 'doctor', companyId: 'company' })).status, 401);
});
