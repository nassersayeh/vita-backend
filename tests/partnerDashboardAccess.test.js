const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createRequire } = require('node:module');
function load(file, mocks) {
  const filename = require.resolve(file), native = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, console, Buffer, process, require: name => name in mocks ? mocks[name] : native(name) });
  return module.exports;
}
test('legacy clinic membership includes owner, doctors, staff and linked departments', async () => {
  const access = load('../utils/partnerAccess', { '../models/Clinic': { find: () => ({ select() { return this; }, lean: async () => [{ _id: 'clinic', ownerId: 'owner', doctors: [{ doctorId: 'dentist' }, { doctorId: 'physician' }], staff: [{ userId: 'accountant' }] }] }) } });
  for (const id of ['owner', 'dentist', 'physician', 'accountant']) assert.equal(await access.usesLegacyClinicDashboard({ _id: id }), true);
  assert.equal(await access.usesLegacyClinicDashboard({ _id: 'pharmacy', clinicId: 'clinic' }), true);
  assert.equal(await access.usesLegacyClinicDashboard({ _id: 'independent' }), false);
  assert.equal(access.isDentist({ specialty: 'طب أسنان' }), true);
  assert.equal(access.isDentist({ specialty: 'Internal Medicine' }), false);
});
function request(router, url, user, body = {}, method = 'POST') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No response')), 2000);
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { clearTimeout(timer); resolve({ status: this.statusCode, body }); } };
    router.handle({ method, url, originalUrl: url, headers: {}, user, body, query: {} }, res, error => { clearTimeout(timer); reject(error || new Error('No route')); });
  });
}
test('general doctor can save report without teeth; clinic doctor remains on legacy workflow', async () => {
  let saved;
  const router = load('../routes/partnerWorkflowsV2', {
    '../middleware/auth': (req, res, next) => next(),
    '../utils/partnerAccess': { isDentist: user => user.specialty === 'Dentistry', usesLegacyClinicDashboard: async user => !!user.legacy },
    '../services/whatsappService': {},
    '../models/User': { findOne: () => ({ select: async () => ({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' }) }) },
    '../models/MedicalRecord': { create: async value => { saved = value; return { ...value, _id: 'report' }; } },
    '../models/Financial': { findOne: async () => ({ transactions: [], debts: [], save: async () => {} }) },
  });
  const body = { patientId: 'bbbbbbbbbbbbbbbbbbbbbbbb', diagnosis: 'Clinical diagnosis', selectedTeeth: [], billing: { paymentMethod: 'cash', totalAmount: 0 } };
  const physician = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'Doctor', specialty: 'Internal Medicine', patients: ['bbbbbbbbbbbbbbbbbbbbbbbb'] };
  assert.equal((await request(router, '/dentist/reports', physician, body)).status, 201);
  assert.equal(saved.selectedTeeth.length, 0);
  assert.equal((await request(router, '/dentist/reports', { ...physician, patients: [] }, body)).status, 403);
  assert.equal((await request(router, '/dentist/reports', { ...physician, specialty: 'Dentistry' }, body)).status, 400);
  assert.equal((await request(router, '/dentist/reports', { ...physician, legacy: true }, body)).status, 403);
  const policy = await request(router, '/dashboard-policy', { ...physician, legacy: true }, {}, 'GET');
  assert.equal(policy.body.legacy, true);
});
