const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { findPrescriptionPatient, patientOrderFilter } = require('../utils/pharmacyPatientLookup');
function setup() {
  const seen = { prescriptions: [], orders: [], counts: [], patients: [] };
  const query = rows => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, skip(n) { seen.offset = n; return this; }, limit(n) { seen.limit = n; return this; }, lean: async () => rows });
  const mocks = {
    '../middleware/auth': (req, res, next) => next(),
    '../utils/partnerAccess': { usesLegacyClinicDashboard: async () => false, isDentist: () => false },
    '../services/whatsappService': {},
    '../models/Order': { find(filter) { seen.orders.push(filter); return query([{ _id: 'order', user: { fullName: 'Patient' }, items: [] }]); }, countDocuments: async filter => { seen.counts.push(filter); return 1; } },
    '../models/User': { find(filter) { seen.patients.push(filter); return { select() { return this; }, limit: async () => [{ _id: 'patient' }] }; } },
    '../models/EPrescription': { find(filter) { seen.prescriptions.push(filter); return query([]); }, countDocuments() { throw Error('Global prescription count is forbidden'); } },
    '../models/PharmacyPrescriptionQuote': { find: () => query([]), countDocuments: async () => 0 },
    '../models/PharmacyInventory': { find: () => query([]) },
    '../controllers/orderController': { updateOrderStatus(req, res) { seen.statusActor = req.user._id; res.json({ success: true }); } },
  };
  const file = require.resolve('../routes/partnerWorkflowsV2'), native = createRequire(file), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, console, process, Buffer, require: name => name in mocks ? mocks[name] : native(name) });
  const request = (path, params = {}, role = 'Pharmacy', method = 'GET') => new Promise((resolve, reject) => module.exports.handle({ method, url: path, originalUrl: path, headers: {}, query: params, body: { status: 'accepted' }, user: { _id: 'my-pharmacy', role, activationStatus: 'active' } }, { code: 200, status(code) { this.code = code; return this; }, json(body) { resolve({ code: this.code, body }); } }, reject));
  return { request, seen };
}
test('home endpoint returns only own patient orders with approval, excluding POS paid sales, and paginates', async () => {
  const { request, seen } = setup();
  const res = await request('/pharmacy/orders', { page: 2, pharmacyId: 'someone-else' });
  assert.equal(res.code, 200); assert.equal(res.body.orders.length, 1);
  assert.equal(seen.orders[0].pharmacyId, 'my-pharmacy'); assert.equal(seen.orders[0].user.$ne, null); assert.equal(seen.orders[0].status.$ne, 'paid');
  assert.equal(seen.orders[0].$or[0].adminApprovalStatus, 'approved'); assert.equal(seen.offset, 25); assert.equal(seen.limit, 25);
  assert.equal(seen.prescriptions.length, 0);
  assert.equal((await request('/pharmacy/orders', { page: -1 })).code, 400);
  assert.equal((await request('/pharmacy/orders', {}, 'Doctor')).code, 403);
});
test('context counter counts own pending patient requests instead of system prescriptions', async () => {
  const { request, seen } = setup(); const res = await request('/context');
  assert.equal(res.code, 200); assert.equal(res.body.stats.incoming, 1);
  assert.equal(seen.counts[0].pharmacyId, 'my-pharmacy'); assert.equal(seen.counts[0].status, 'pending');
});
test('prescription route rejects empty lookup and always scopes results to one patient', async () => {
  const { request, seen } = setup();
  assert.equal((await request('/pharmacy/prescriptions')).code, 400); assert.equal(seen.prescriptions.length, 0);
  assert.equal((await request('/pharmacy/prescriptions', { patientSearch: '0591234567' })).code, 200);
  assert.equal(seen.prescriptions[0].patientId, 'patient'); assert.ok(!('distributionChannel' in seen.prescriptions[0]));
  assert.equal(seen.patients[0].role, 'User'); assert.ok(seen.patients[0].$or[1].mobileNumber.$in.includes('970591234567'));
  assert.equal((await request('/pharmacy/prescriptions', { idNumber: '123456789' })).code, 200);
  assert.equal(seen.prescriptions[1].patientId, 'patient');
});
test('order status changes use the authenticated pharmacy through the protected route', async () => {
  const { request, seen } = setup(); assert.equal((await request('/pharmacy/orders/aaaaaaaaaaaaaaaaaaaaaaaa/status', {}, 'Pharmacy', 'PUT')).code, 200); assert.equal(seen.statusActor, 'my-pharmacy');
  assert.equal((await request('/pharmacy/orders/aaaaaaaaaaaaaaaaaaaaaaaa/status', {}, 'User', 'PUT')).code, 403);
});
test('lookup handles local/international mobile, ID, unknown identity and shared phone ambiguity', async () => {
  let filter;
  const user = rows => ({ find(value) { filter = value; return { select() { return this; }, limit: async () => rows }; } });
  assert.equal(await findPrescriptionPatient(user([{ _id: 'p' }]), '+970 59 123 4567'), 'p');
  assert.ok(filter.$or[1].mobileNumber.$in.includes('0591234567'));
  assert.equal(await findPrescriptionPatient(user([]), '123456789'), null);
  await assert.rejects(findPrescriptionPatient(user([{ _id: 'a' }, { _id: 'b' }]), '0591234567'), { status: 409 });
  for (const value of [undefined, {}, '12', '.*', 'x'.repeat(50)]) await assert.rejects(findPrescriptionPatient(user([]), value), { status: 400 });
  assert.equal(patientOrderFilter('p').pharmacyId, 'p');
});
