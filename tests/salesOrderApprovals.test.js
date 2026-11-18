const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function setup() {
  let filter, saved = false;
  const order = { _id: 'order', user: { _id: 'patient' }, status: 'pending', adminApprovalStatus: 'pending', pharmacyId: 'pharmacy', save: async () => { saved = true; } };
  const filename = require.resolve('../controllers/orderController'), native = createRequire(filename), module = { exports: {} };
  const query = { populate() { return this; }, sort() { return this; }, limit() { return this; }, lean() { return this; }, exec: async () => [order] };
  const mocks = {
    '../models/Order': { find(value) { filter = value; return query; }, findById: () => ({ populate: async () => order }), countDocuments: async () => 1 },
    '../models/User': { findOne: () => ({ select: async () => ({ _id: 'pharmacy' }) }) },
    '../models/Notification': { create: async () => {} },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console, require: name => name in mocks ? mocks[name] : name.startsWith('../models/') || name.startsWith('../services/') ? {} : native(name) });
  const call = async (method, role, body = {}) => {
    let result;
    await module.exports[method]({ user: { _id: 'actor', role }, params: { orderId: 'order' }, body }, {
      code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { result = { code: this.code, body }; }
    });
    return result;
  };
  return { call, order, filter: () => filter, saved: () => saved };
}
test('team lead lists only pending orders and sees pending count', async () => {
  const f = setup();
  assert.equal((await f.call('getAdminOrders', 'SalesTeamLead')).code, 200);
  assert.equal(f.filter().adminApprovalStatus, 'pending');
  assert.equal(f.filter().status, 'pending');
  assert.equal((await f.call('getPendingOrderCount', 'SalesTeamLead')).body.count, 1);
});
test('team lead approves orders with authenticated actor and retains pharmacy assignment', async () => {
  const f = setup();
  assert.equal((await f.call('reviewOrderByAdmin', 'SalesTeamLead', { action: 'approve', pharmacyId: 'pharmacy' })).code, 200);
  assert.equal(f.order.adminApprovalStatus, 'approved');
  assert.equal(f.order.adminApprovedBy, 'actor');
  assert.equal(f.saved(), true);
  assert.equal((await f.call('reviewOrderByAdmin', 'SalesTeamLead', { action: 'approve' })).code, 409);
});
test('ordinary sales, patients and pharmacies cannot list, count or approve orders', async () => {
  for (const role of ['SalesManager', 'User', 'Doctor', 'Pharmacy']) {
    const f = setup();
    for (const method of ['getAdminOrders', 'getPendingOrderCount', 'reviewOrderByAdmin']) assert.equal((await f.call(method, role, { action: 'approve' })).code, 403);
    assert.equal(f.saved(), false);
  }
});
test('lead cannot redirect an order away from the patient selected pharmacy', async () => {
  const f = setup();
  assert.equal((await f.call('reviewOrderByAdmin', 'SalesTeamLead', { action: 'approve', pharmacyId: 'other' })).code, 400);
  assert.equal(f.saved(), false);
});
