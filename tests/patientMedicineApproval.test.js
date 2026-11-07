const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = require.resolve('../controllers/orderController');
const native = createRequire(filename);
const pharmacyId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const patientId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const drugId = 'cccccccccccccccccccccccc';
const adminId = 'dddddddddddddddddddddddd';

function setup({ enabled = true, notificationsFail = false } = {}) {
  let stored, lastPharmacyFilter, countFilter;
  const notifications = [];
  const clone = value => structuredClone(value);
  const query = value => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, limit() { return this; }, lean() { return this; }, exec: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
  class Order {
    static async countDocuments(filter) { countFilter = filter; return 321; }
    constructor(value) { Object.assign(this, value); this._id ||= 'eeeeeeeeeeeeeeeeeeeeeeee'; }
    async save() {
      if (this.$where && (stored.adminApprovalStatus !== this.$where.adminApprovalStatus || stored.status !== this.$where.status)) throw Object.assign(new Error('Changed'), { name: 'DocumentNotFoundError' });
      const { $where, ...data } = this;
      stored = clone(data);
    }
    static findById() { return query(stored ? new Order({ ...clone(stored), user: { _id: patientId, fullName: 'Patient' } }) : null); }
    static find(filter) {
      const visible = stored && String(stored.pharmacyId) === filter.pharmacyId && filter.$or.some(condition => condition.adminApprovalStatus === stored.adminApprovalStatus);
      return query(visible ? [clone(stored)] : []);
    }
  }
  const mocks = {
    mongoose: { isValidObjectId: value => /^[a-f\d]{24}$/.test(value) },
    '../models/Order': Order,
    '../models/User': {
      findOne(filter) { lastPharmacyFilter = filter; return query(enabled && filter._id === pharmacyId ? { _id: pharmacyId, city: 'Nablus', fullName: 'Network pharmacy' } : null); },
      find: () => query([{ _id: adminId }]),
      findById: () => query({ _id: patientId, fullName: 'Patient', save: async () => {} }),
    },
    '../models/EPrescription': { findOne: filter => query(filter.patientId === patientId ? { _id: drugId, validityType: 'repeat' } : null) },
    '../models/Points': { findOne: async () => { throw new Error('Optional rewards unavailable'); } },
    '../models/Notification': { create: async values => { if (notificationsFail) throw new Error('Offline'); notifications.push(...(Array.isArray(values) ? values : [values])); } },
    '../utils/catalogCheckoutPricing': { catalogCheckoutPricing: async values => values.map(() => ({ drugId, drugName: 'Medicine', price: 25 })) },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console: { log() {}, warn() {}, error() {} }, require: name => name in mocks ? mocks[name] : name.startsWith('../utils/') ? native(name) : {} });
  async function call(handler, { role = 'User', id = patientId, body = {}, params = {} } = {}) {
    let result;
    await module.exports[handler]({ user: { _id: id, role }, body, params, query: {} }, { code: 200, set() { return this; }, status(value) { this.code = value; return this; }, json(value) { result = { status: this.code, body: value }; } });
    return result;
  }
  const body = { pharmacyId, items: [{ item: drugId, onModel: 'Product', quantity: 1, name: 'Medicine', price: 999 }], total: 25, deliveryMethod: 'pickup', orderType: 'manual', adminApprovalStatus: 'approved', user: adminId };
  return { call, body, notifications, stored: () => stored, filter: () => lastPharmacyFilter, countFilter: () => countFilter, cancel: () => { stored.status = 'cancelled'; } };
}

test('admin badge counts all pending patient orders, excluding cancelled orders and POS sales', async () => {
  const s = setup();
  const response = await s.call('getPendingOrderCount', { role: 'Admin', id: adminId });
  assert.equal(response.status, 200); assert.equal(response.body.count, 321);
  assert.equal(s.countFilter().adminApprovalStatus, 'pending');
  assert.equal(s.countFilter().status, 'pending');
  assert.equal(s.countFilter().user.$ne, null);
  assert.equal((await s.call('getPendingOrderCount', { role: 'Superadmin', id: adminId })).status, 200);
});

test('patient and pharmacy roles cannot read the admin badge count', async () => {
  const s = setup();
  assert.equal((await s.call('getPendingOrderCount')).status, 403);
  assert.equal((await s.call('getPendingOrderCount', { role: 'Pharmacy', id: pharmacyId })).status, 403);
  assert.equal(s.countFilter(), undefined);
});

test('patient choice persists pending review and only admins receive the initial notification', async () => {
  const s = setup();
  assert.equal((await s.call('createOrder', { body: s.body })).status, 201);
  assert.equal(s.stored().user, patientId);
  assert.equal(s.stored().pharmacyId, pharmacyId);
  assert.equal(s.stored().adminApprovalStatus, 'pending');
  assert.equal(s.stored().adminApprovedAt, undefined);
  assert.equal(s.stored().deliveryMethod, 'pickup'); assert.equal(s.stored().deliveryFee, 0);
  assert.equal(s.filter().prescriptionDispensingEnabled, true);
  assert.equal(s.notifications.length, 1); assert.equal(s.notifications[0].user, adminId);
  const before = await s.call('getPharmacyOrders', { role: 'Pharmacy', id: pharmacyId, params: { pharmacyId } });
  assert.equal(before.body.length, 0);
  assert.equal((await s.call('getOrderById', { role: 'Pharmacy', id: pharmacyId, params: { orderId: s.stored()._id } })).status, 403);
  assert.equal((await s.call('getAdminOrders', { role: 'Pharmacy', id: pharmacyId })).status, 403);
  const approved = await s.call('reviewOrderByAdmin', { role: 'Admin', id: adminId, params: { orderId: s.stored()._id }, body: { action: 'approve' } });
  assert.equal(approved.status, 200); assert.equal(s.stored().pharmacyId, pharmacyId);
  assert.equal(s.stored().adminApprovalStatus, 'approved');
  assert.equal(s.notifications[1].user, pharmacyId);
  const after = await s.call('getPharmacyOrders', { role: 'Pharmacy', id: pharmacyId, params: { pharmacyId } });
  assert.equal(after.body.length, 1);
});

test('admin cannot replace the chosen pharmacy, review twice, or approve a cancelled order', async () => {
  const s = setup(); await s.call('createOrder', { body: s.body });
  const params = { orderId: s.stored()._id };
  assert.equal((await s.call('reviewOrderByAdmin', { role: 'Admin', id: adminId, params, body: { action: 'approve', pharmacyId: patientId } })).status, 400);
  assert.equal(s.stored().adminApprovalStatus, 'pending');
  assert.equal((await s.call('reviewOrderByAdmin', { params, body: { action: 'approve' } })).status, 403);
  assert.equal((await s.call('reviewOrderByAdmin', { role: 'Admin', id: adminId, params, body: { action: 'reject', reason: 'Unavailable' } })).status, 200);
  assert.equal(s.stored().adminApprovalStatus, 'rejected'); assert.equal(s.stored().status, 'declined');
  assert.equal((await s.call('reviewOrderByAdmin', { role: 'Admin', id: adminId, params, body: { action: 'approve' } })).status, 409);
  const cancelled = setup(); await cancelled.call('createOrder', { body: cancelled.body }); cancelled.cancel();
  assert.equal((await cancelled.call('reviewOrderByAdmin', { role: 'Admin', id: adminId, params, body: { action: 'approve' } })).status, 409);
});

test('unselected network pharmacies and delivery requests are rejected at the server', async () => {
  const disabled = setup({ enabled: false });
  assert.equal((await disabled.call('createOrder', { body: disabled.body })).status, 400);
  assert.equal(disabled.stored(), undefined);
  const s = setup();
  const delivery = await s.call('createOrder', { body: { ...s.body, deliveryMethod: 'delivery' } });
  assert.equal(delivery.status, 400); assert.equal(delivery.body.code, 'PICKUP_ONLY');
  assert.equal(s.stored(), undefined);
});

test('uploaded and saved prescriptions keep the same selected pharmacy and approval workflow', async () => {
  for (const orderType of ['upload', 'prescription']) {
    const s = setup({ notificationsFail: true });
    const response = await s.call('createOrder', { body: { ...s.body, orderType, prescriptionId: orderType === 'prescription' ? drugId : undefined, ...(orderType === 'upload' ? { items: [], total: 0, prescriptionImage: { fileUrl: 'https://vita.ps/uploads/prescriptions/test.jpg' } } : {}) } });
    assert.equal(response.status, 201); assert.equal(s.stored().adminApprovalStatus, 'pending');
    assert.equal(s.stored().pharmacyId, pharmacyId); assert.equal(s.stored().deliveryFee, 0);
    assert.equal((await s.call('reviewOrderByAdmin', { role: 'Admin', id: adminId, params: { orderId: s.stored()._id }, body: { action: 'approve' } })).status, 200);
    assert.equal(s.stored().adminApprovalStatus, 'approved');
  }
});
