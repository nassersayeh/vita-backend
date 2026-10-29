const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function setup() {
  let saved = false;
  const order = { _id: 'order-id', user: { _id: 'patient-id' }, pharmacyId: 'pharmacy-id', status: 'pending', adminApprovalStatus: 'approved', items: [{ item: 'medicine-id', onModel: 'Product', name: 'Medicine', price: 12, quantity: 2 }], deliveryFee: 15, total: 39, save: async () => { saved = true; } };
  function load(file, mocks) {
    const filename = require.resolve(file), native = createRequire(filename), module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, exports: module.exports, __dirname: require('node:path').dirname(filename),
      console: { log() {}, error() {}, warn() {} },
      require: name => name in mocks ? mocks[name] : name.startsWith('../models/') || name.startsWith('../services/') ? {} : native(name),
    });
    return module.exports;
  }
  const controller = load('../controllers/orderController', {
    '../models/Order': { findById: () => ({ populate: async () => order }) },
    '../models/User': { findById: async () => null },
    '../models/Notification': { create: async () => {} },
  });
  const router = load('../routes/orderRoutes', {
    '../controllers/orderController': new Proxy(controller, { get: (target, key) => target[key] || ((req, res) => res.json({})) }),
    '../middleware/auth': (req, res, next) => {
      if (!req.actor) return res.status(401).json({});
      req.user = req.actor;
      next();
    },
    fs: { mkdirSync() {} },
  });
  const request = (path, actor, body = { status: 'cancelled' }) => new Promise((resolve, reject) => {
    router.handle({ method: 'PUT', url: path, headers: {}, actor, body }, {
      code: 200, status(code) { this.code = code; return this; }, json(body) { resolve({ code: this.code, body, saved }); },
    }, reject);
  });
  return { request };
}

test('both status routes authenticate the owner before cancelling their order', async () => {
  for (const url of ['/order-id/status', '/order-id']) {
    const result = await setup().request(url, { _id: 'patient-id', role: 'User' });
    assert.equal(result.code, 200);
    assert.equal(result.saved, true);
    assert.equal(result.body.order.status, 'cancelled');
    assert.equal(result.body.order.statusHistory[0].changedBy, 'patient-id');
  }
});

test('owning pharmacy accepts with a discount; another pharmacy and a patient cannot price the order', async () => {
  const body = { status: 'accepted', pricingItems: [{ index: 0, discountedPrice: 9 }] };
  const result = await setup().request('/order-id/status', { _id: 'pharmacy-id', role: 'Pharmacy' }, body);
  assert.equal(result.code, 200);
  assert.equal(result.body.order.originalTotal, 39);
  assert.equal(result.body.order.total, 33);
  assert.equal(result.body.order.discountAmount, 6);
  assert.equal(result.body.order.items[0].originalPrice, 12);
  assert.equal(result.body.order.items[0].price, 9);
  assert.ok(result.body.order.pharmacyPricedAt);
  const other = await setup().request('/order-id/status', { _id: 'other', role: 'Pharmacy' }, body);
  assert.equal(other.code, 403);
  const patient = await setup().request('/order-id/status', { _id: 'patient-id', role: 'User' }, body);
  assert.equal(patient.code, 403);
});

test('another patient and an anonymous request cannot cancel the order', async () => {
  const other = await setup().request('/order-id/status', { _id: 'other-patient', role: 'User' });
  assert.equal(other.code, 403);
  assert.equal(other.saved, false);
  const anonymous = await setup().request('/order-id/status');
  assert.equal(anonymous.code, 401);
  assert.equal(anonymous.saved, false);
});
