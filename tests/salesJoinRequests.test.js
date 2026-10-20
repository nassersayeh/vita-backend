const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function load(file, mocks) {
  const filename = require.resolve(file), native = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console, process, Buffer, require: name => name in mocks ? mocks[name] : native(name) });
  return module.exports;
}
function router(User, approveUser = () => { throw Error('Unexpected approval'); }) {
  return load('../routes/adminSales', { '../models/User': User, '../services/salesMetrics': {}, '../controllers/adminController': { approveUser } });
}
function request(router, method, url, role = 'SalesTeamLead', body = {}, query = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('No response')), 2000);
    router.handle({ method, url, originalUrl: url, headers: {}, user: { role, _id: 'verified-lead' }, body, query }, {
      statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { clearTimeout(timer); resolve({ status: this.statusCode, body }); }
    }, error => { clearTimeout(timer); reject(error || Error('Unhandled route')); });
  });
}
test('ordinary sales staff cannot list or approve join requests', async () => {
  const app = router({});
  for (const role of ['SalesManager', 'Doctor', 'Pharmacy', undefined]) {
    assert.equal((await request(app, 'GET', '/join-requests', role || 'unknown')).status, 403);
    assert.equal((await request(app, 'PUT', '/join-requests/aaaaaaaaaaaaaaaaaaaaaaaa/approve', role || 'unknown')).status, 403);
  }
});
test('lead list includes pending provider registrations only and paginates', async () => {
  let filter, selection, offset;
  const app = router({ find(value) { filter = value; return {
    select(value) { selection = value; return this; }, sort() { return this; }, skip(value) { offset = value; return this; }, limit(value) { assert.equal(value, 25); return this; }, lean: async () => [{ fullName: 'Pending doctor' }]
  }; }, countDocuments: async () => 30 });
  const res = await request(app, 'GET', '/join-requests', 'SalesTeamLead', {}, { page: 2, role: 'Admin', status: 'active' });
  assert.equal(res.status, 200);
  assert.equal(filter.activationStatus, 'pending');
  assert.deepEqual(Array.from(filter.role.$in), ['Doctor', 'Pharmacy', 'Lab', 'Institution', 'Hospital']);
  assert.equal(offset, 25);
  assert.ok(selection.includes('subscriptionPlanKey') && selection.includes('mobileNumber'));
  assert.ok(!selection.includes('password') && !selection.includes('patients'));
  assert.equal(res.body.total, 30);
});
test('approval route validates IDs and supplies the verified actor and registration action', async () => {
  let seen;
  const app = router({}, (req, res) => { seen = req.body; res.json({ success: true }); });
  assert.equal((await request(app, 'PUT', '/join-requests/invalid/approve')).status, 400);
  assert.equal((await request(app, 'PUT', '/join-requests/aaaaaaaaaaaaaaaaaaaaaaaa/approve', 'SalesTeamLead', { adminId: 'forged', status: 'declined', requestType: 'plan_change' })).status, 200);
  assert.equal(seen.status, 'active');
  assert.equal(seen.requestType, 'registration');
  assert.equal(seen.adminId, 'verified-lead');
});
function controller(account) {
  const mocks = Object.fromEntries(['AdminNotification', 'Points', 'Order', 'Appointment', 'Financial', 'PotentialClientStatus', 'PointSettings', 'LandingAnalyticsEvent', 'DemoRequest'].map(name => [`../models/${name}`, {}]));
  return load('../controllers/adminController', { ...mocks, '../models/User': { findById: async () => account }, '../utils/assignDefaultInventory': { assignDefaultInventory: async () => 0 }, '../services/whatsappService': { isWhatsAppReady: async () => false } });
}
async function approve(account, body = {}) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  await controller(account).approveUser({ params: { userId: 'doctor' }, user: { _id: 'verified-lead', role: 'SalesTeamLead' }, body: { status: 'active', requestType: 'registration', adminId: 'forged', ...body } }, res);
  return res;
}
test('lead approval uses the admin plan logic and records the authenticated actor', async () => {
  let saved = 0;
  const account = { _id: 'doctor', role: 'Doctor', fullName: 'Doctor', activationStatus: 'pending', subscriptionPlanKey: 'core', save: async () => { saved += 1; } };
  assert.equal((await approve(account)).statusCode, 200);
  assert.equal(saved, 1);
  assert.equal(account.activationStatus, 'active');
  assert.equal(account.approvedBy, 'verified-lead');
  assert.equal(account.subscriptionStatus, 'trial');
  assert.equal(account.isPaid, false);
  assert.ok(account.trialEndDate - account.trialStartDate === 7 * 86400000);
});
test('lead cannot approve privileged accounts, reactivate accounts, reject or change plans', async () => {
  for (const role of ['Admin', 'Superadmin', 'SalesManager', 'SalesTeamLead', 'User']) assert.equal((await approve({ role, activationStatus: 'pending' })).statusCode, 403);
  assert.equal((await approve({ role: 'Doctor', activationStatus: 'active', planChangeRequest: { status: 'pending' } })).statusCode, 409);
  assert.equal((await approve({}, { status: 'declined' })).statusCode, 403);
  assert.equal((await approve({}, { requestType: 'plan_change' })).statusCode, 403);
  assert.equal((await approve(null)).statusCode, 404);
});
