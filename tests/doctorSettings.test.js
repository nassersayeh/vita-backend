const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function load(file, mocks) {
  const filename = require.resolve(file), native = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, Buffer, console, process: { env: { JWT_SECRET: 'test-only-signing-secret' } }, require: name => name in mocks ? mocks[name] : native(name) });
  return module.exports;
}
function request(router, method, url, user, body = {}, query = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No response')), 3000);
    const res = { set() { return this; }, statusCode: 200, status(value) { this.statusCode = value; return this; }, json(body) { clearTimeout(timeout); resolve({ status: this.statusCode, body }); } };
    router.handle({ method, url, originalUrl: url, headers: {}, user, body, query }, res, error => { clearTimeout(timeout); reject(error || new Error('Unhandled route')); });
  });
}
const auth = (req, res, next) => req.user ? next() : res.status(401).json({});
const limiter = (req, res, next) => next();
function router(mocks = {}) {
  const noop = (req, res) => res.json({});
  return load('../routes/doctors', {
    '../middleware/auth': auth,
    '../middleware/authRateLimiter': { salesPasswordLimiter: limiter },
    '../models/User': {},
    '../controllers/doctorsController': new Proxy({}, { get: () => noop }),
    '../controllers/doctorPatientController': new Proxy({}, { get: () => noop }),
    ...mocks,
  });
}
test('doctor password endpoint rejects anonymous and non-doctor accounts', async () => {
 const app = router();
 assert.equal((await request(app, 'POST', '/password')).status, 401);
 for (const role of ['User', 'Pharmacy', 'SalesManager', 'Admin']) assert.equal((await request(app, 'POST', '/password', {role})).status, 403);
});
test('password changes require current password and atomically invalidate old sessions', async () => {
  let mutation;
  const app = router({ bcryptjs: { compare: async value => value === 'current-pass', hash: async () => 'new-hash' }, '../models/User': { updateOne: async (filter, update) => { mutation = { filter, update }; return { modifiedCount: 1 }; } } });
  const user = { _id: 'manager-A', role: 'Doctor', fullName: 'Test Manager', password: 'old-hash' };
  assert.equal((await request(app, 'POST', '/password', user, { currentPassword: 'bad', newPassword: 'strong-12345' })).status, 400);
  assert.equal(mutation, undefined);
  assert.equal((await request(app, 'POST', '/password', user, { currentPassword: 'current-pass', newPassword: 'strong-12345' })).status, 200);
  assert.equal(mutation.filter._id, 'manager-A');
  assert.equal(mutation.filter.password, 'old-hash');
  assert.equal(mutation.update.$set.password, 'new-hash');
  assert.ok(mutation.update.$set.passwordChangedAt);
});
test('profile accepts doctor settings but rejects privilege and password mutations', () => {
 const { permittedFields, profileFields } = require('../utils/profileFields');
 assert.equal(permittedFields({ fullName: 'Doctor', address: 'Address', specialty: 'Dentistry', workplaces: [], workingSchedule: [], licenseNumber: '123', yearsOfExperience: 3, allowPatientDurationChoice: false }, profileFields), true);
 for (const key of ['role', 'password', 'activationStatus', 'controlledDoctorAuthorized']) assert.equal(permittedFields({[key]: true}, profileFields), false);
});
