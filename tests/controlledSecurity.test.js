const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Rx = require('../models/ControlledPrescription');
const { signPrescription, verifyPrescription } = require('../utils/controlledIntegrity');
const { profileFields, healthFields, permittedFields } = require('../utils/profileFields');
const { ownerOrAdmin, requireAdmin } = require('../middleware/accountAuthorization');
process.env.CONTROLLED_SIGNING_KEY = 'isolated-test-signing-key-never-used-for-live-prescriptions';
const objectId = () => new mongoose.Types.ObjectId();
function prescription() {
  const rx = new Rx({ serial: 'PS-CR-TEST-0001', allocationId: objectId(), doctorId: objectId(), patientId: objectId(), issuedAt: new Date(), validityType: 'time-limited', expiryDate: new Date(Date.now() + 86400000), issueRequestId: 'test-issue-request-123',
    patientSnapshot: { _id: objectId(), fullName: 'Synthetic patient', idNumber: 'TEST-ONLY' }, doctorSnapshot: { fullName: 'Synthetic doctor' },
    products: [{ drugId: objectId(), quantity: 2, allowedPills: 20, dose: '1', name: 'Test drug', frequency: 'daily' }], integrityVersion: 1 });
  rx.integritySeal = signPrescription(rx); return rx;
}
test('clinical seal survives hydration, storage serialization and population; detects changes to all clinical identities', () => {
  const rx = prescription(); assert.equal(verifyPrescription(rx), true);
  const plain = rx.toObject(); assert.equal(verifyPrescription(plain), true);
  assert.equal(verifyPrescription({ ...plain, doctorId: { _id: plain.doctorId, fullName: 'current name' }, patientId: { _id: plain.patientId } }), true);
  for (const field of ['serial', 'doctorId', 'patientId', 'allocationId', 'expiryDate', 'validityType', 'diagnosis', 'notes', 'issueRequestId']) {
    assert.equal(verifyPrescription({ ...plain, [field]: field === 'expiryDate' ? new Date(0) : 'changed' }), false, field);
  }
  for (const field of ['quantity', 'allowedPills', 'dose', 'frequency', 'drugId', 'name', 'instructions']) {
    assert.equal(verifyPrescription({ ...plain, products: [{ ...plain.products[0], [field]: 'changed' }] }), false, field);
  }
  assert.equal(verifyPrescription({ ...plain, patientSnapshot: { ...plain.patientSnapshot, idNumber: 'changed' } }), false);
  assert.equal(verifyPrescription({ ...plain, integritySeal: undefined }), false);
  assert.equal(verifyPrescription({ ...plain, integritySeal: 'a'.repeat(64) }), false);
  assert.equal(verifyPrescription({ ...plain, stoppedAt: new Date(), isValid: false, dispensedCount: 1 }), true);
});
test('profile and health updates cannot change roles, passwords, verification, money or nested operator fields', () => {
  for (const key of ['role', 'password', 'passwordChangedAt', 'activationStatus', 'unionApproved', 'ministrySuspended', '$set', 'role.value', '__proto__', 'isPaid', 'phoneVerified', 'resetCode']) {
    const body = JSON.parse(`{"${key}":"test"}`);
    assert.equal(permittedFields(body, profileFields), false, key);
    assert.equal(permittedFields(body, healthFields), false, key);
  }
  assert.equal(permittedFields({ fullName: 'Test' }, profileFields), true);
  assert.equal(permittedFields({ allergies: [] }, healthFields), true);
  assert.equal(permittedFields([], healthFields), false);
});
test('account mutations require the owner or an administrator; normal doctors cannot administer accounts', () => {
  const run = (middleware, user, id = 'victim') => {
    let next = false, status;
    middleware({ user, params: { id } }, { status(value) { status = value; return this; }, json() {} }, () => { next = true; });
    return { next, status };
  };
  assert.equal(run(ownerOrAdmin('id'), { _id: 'attacker', role: 'Doctor' }).status, 403);
  assert.equal(run(ownerOrAdmin('id'), { _id: 'victim', role: 'Doctor' }).next, true);
  assert.equal(run(requireAdmin, { role: 'Doctor' }).status, 403);
  assert.equal(run(requireAdmin, { role: 'Admin' }).next, true);
});
test('legacy hydrated account responses never serialize password hashes or reset/verification secrets', () => {
  const User = require('../models/User');
  const user = new User({ fullName: 'Synthetic', role: 'User', password: 'hash', resetCode: 'secret', phoneVerificationCode: 'secret', twoFactorCode: 'secret' });
  const json = JSON.parse(JSON.stringify(user));
  for (const key of ['password', 'resetCode', 'phoneVerificationCode', 'twoFactorCode']) assert.equal(json[key], undefined);
});
test('regulated drugs cannot be disguised as an ordinary prescription or sale for a Palestinian provider', async () => {
  const { assertOrdinaryAllowed } = require('../utils/ordinaryControlledGuard');
  const drugId = objectId();
  const models = { Catalogue: { find: () => ({ populate: () => ({ lean: async () => [{ drugId: { _id: drugId, name: 'Test Regulated Medicine' } }] }) }) } };
  const palestinian = { country: 'Palestine' };
  await assert.rejects(assertOrdinaryAllowed([{ drugId }], palestinian, models), { code: 'CONTROLLED_REQUIRED' });
  await assert.rejects(assertOrdinaryAllowed([{ name: '  test   regulated medicine  ' }], palestinian, models), { code: 'CONTROLLED_REQUIRED' });
  await assertOrdinaryAllowed([{ drugId: objectId(), name: 'Ordinary medicine' }], palestinian, models);
  await assertOrdinaryAllowed([{ drugId }], { country: 'Jordan' }, models);
});
test('security logging fails closed and excludes body, query strings, tokens and passwords', async () => {
  const vm = require('vm'), fs = require('fs');
  const source = fs.readFileSync(require.resolve('../middleware/controlledSecurityLog'), 'utf8');
  const run = async fail => {
    let captured, completed, next = false, finish, status = 200;
    const module = { exports: {} };
    vm.runInNewContext(source, { module, console, require: name => name === 'crypto' ? require('crypto') : {
      create: async value => { if (fail) throw new Error('offline'); captured = value; },
      updateOne: async (query, update) => { completed = update; },
    } });
    const req = { controlledActor: { id: objectId(), role: 'ministry_of_health' }, method: 'GET', path: '/prescriptions', route: { path: '/prescriptions' }, params: {}, query: { idNumber: 'DO-NOT-LOG' }, body: { password: 'DO-NOT-LOG' }, headers: { authorization: 'DO-NOT-LOG' } };
    const res = { statusCode: 200, set() {}, status(code) { status = code; return this; }, json() {}, on(event, fn) { finish = fn; } };
    await module.exports(req, res, () => { next = true; });
    if (finish) { finish(); await Promise.resolve(); }
    return { next, status, captured, completed };
  };
  const offline = await run(true); assert.equal(offline.next, false); assert.equal(offline.status, 503);
  const online = await run(false); assert.equal(online.next, true);
  assert.equal(JSON.stringify(online).includes('DO-NOT-LOG'), false);
  assert.equal(online.completed.$set.status, 200);
});
test('controlled request and password limiters bound attempts per account', () => {
  const { controlledLimiter, controlledAccountLimiter } = require('../middleware/authRateLimiter');
  for (const [limiter, maximum] of [[controlledLimiter, 120], [controlledAccountLimiter, 8]]) {
    const req = { controlledActor: { id: objectId() } }; let next = 0, status;
    const res = { set() {}, status(code) { status = code; return this; }, json() {} };
    for (let i = 0; i < maximum + 1; i++) limiter(req, res, () => next++);
    assert.equal(next, maximum); assert.equal(status, 429);
    limiter({ controlledActor: { id: objectId() } }, res, () => next++);
    assert.equal(next, maximum + 1);
  }
});
