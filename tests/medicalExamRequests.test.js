const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const filename = require.resolve('../routes/medicalExamRequests');
const native = createRequire(filename);
const doctor = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'Doctor', patients: ['bbbbbbbbbbbbbbbbbbbbbbbb'] };
function load({ legacy = false, User = {}, Request = {} } = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, console, require: name => {
    if (name === '../middleware/auth') return (req, res, next) => req.user ? next() : res.status(401).json({});
    if (name === '../utils/partnerAccess') return { usesLegacyClinicDashboard: async () => legacy };
    if (name === '../models/User') return User;
    if (name === '../models/MedicalExamRequest') return Request;
    return native(name);
  } });
  return module.exports;
}
function request(router, method, url, user, body = {}, query = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No response')), 1500);
    const res = { statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { clearTimeout(timer); resolve({ status: this.statusCode, body }); } };
    router.handle({ method, url, originalUrl: url, headers: {}, user, body, query }, res, error => { clearTimeout(timer); reject(error || new Error('No route')); });
  });
}
test('medical exams exclude anonymous, radiology and legacy clinic accounts', async () => {
  assert.equal((await request(load(), 'POST', '/', undefined)).status, 401);
  assert.equal((await request(load(), 'POST', '/', { role: 'Radiology' })).status, 403);
  assert.equal((await request(load({ legacy: true }), 'POST', '/', doctor)).status, 403);
});
test('save without laboratory remains unsent and validates linked patient', async () => {
  let saved;
  const router = load({ User: { exists: async () => true }, Request: { create: async values => { saved = values; return values; } } });
  assert.equal((await request(router, 'POST', '/', doctor, { patientId: 'cccccccccccccccccccccccc', tests: ['CBC'] })).status, 403);
  assert.equal((await request(router, 'POST', '/', doctor, { patientId: doctor.patients[0], tests: [{}] })).status, 400);
  const result = await request(router, 'POST', '/', doctor, { patientId: doctor.patients[0], tests: ['CBC'], doctorId: 'attacker', status: 'completed' });
  assert.equal(result.status, 201);
  assert.equal(saved.doctorId, doctor._id);
  assert.equal(saved.status, 'awaiting_laboratory');
  assert.equal(saved.laboratoryId, null);
});
test('target must be an active independent Lab and queued sending is atomic and owned', async () => {
  let mutation;
  const laboratoryId = 'cccccccccccccccccccccccc';
  const router = load({ User: { findOne(filter) {
    assert.equal(filter.role, 'Lab'); assert.equal(filter.activationStatus, 'active'); assert.equal(filter.clinicId, null);
    return { select() { return this; }, lean: async () => ({ _id: laboratoryId }) };
  } }, Request: { findOneAndUpdate: async (filter, update) => { mutation = { filter, update }; return {}; } } });
  const response = await request(router, 'PATCH', '/dddddddddddddddddddddddd/send', doctor, { laboratoryId });
  assert.equal(response.status, 200);
  assert.equal(mutation.filter.doctorId, doctor._id);
  assert.equal(mutation.filter.status, 'awaiting_laboratory');
  assert.equal(mutation.update.$set.status, 'pending');
  assert.equal((await request(router, 'PATCH', '/dddddddddddddddddddddddd/complete', doctor, { results: 'forged' })).status, 403);
});
test('laboratory results update only requests assigned to authenticated laboratory', async () => {
  let filter;
  const router = load({ User: { exists: async () => true }, Request: { findOneAndUpdate: async match => { filter = match; return null; } } });
  const response = await request(router, 'PATCH', '/dddddddddddddddddddddddd/complete', { _id: 'lab-A', role: 'Lab' }, { results: 'Report' });
  assert.equal(response.status, 404);
  assert.equal(filter.laboratoryId, 'lab-A');
  assert.equal(filter.status, 'pending');
});
