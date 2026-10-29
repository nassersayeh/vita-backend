const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const pharmacyId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
function setup({ available = true, legacy = [], inventory } = {}) {
  const seen = {};
  const query = (result, key) => ({
    select(fields) { seen[key] = fields; return this; },
    populate() { return this; },
    lean: async () => result,
  });
  function load(file, mocks) {
    const filename = require.resolve(file);
    const native = createRequire(filename);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, exports: module.exports, console,
      require: name => name in mocks ? mocks[name] : native(name),
    });
    return module.exports;
  }
  const controller = load('../controllers/patientPharmacyPricingController', {
    '../models/User': { findOne(filter) {
      seen.pharmacy = filter;
      return query(available ? { _id: pharmacyId } : null, 'pharmacyFields');
    } },
    '../models/PharmacyInventory': { find(filter) {
      seen.inventory = filter;
      return query(inventory || [{ drugId: 'drug-1', drugName: 'Medicine', price: 12.5,
        costPrice: 2, notes: 'Private', quantity: 50, minimumStock: 5 }], 'inventoryFields');
    } },
    '../models/Product': { find(filter) {
      seen.legacy = filter;
      return query(legacy, 'legacyFields');
    } },
  });
  const router = load('../routes/pharmacyInventoryRoutes', {
    '../middleware/auth': (req, res, next) => req.user ? next() : res.status(401).json({}),
    '../controllers/patientPharmacyPricingController': controller,
    '../controllers/pharmacyInventoryController': new Proxy({}, { get: () => (req, res) => res.json({ ownerInventory: true }) }),
  });
  const request = (url, role = 'User', method = 'GET', id = 'patient-id', body = {}) => new Promise((resolve, reject) => {
    router.handle({ url, method, body, headers: {}, user: role ? { _id: id, role } : undefined }, {
      code: 200,
      status(code) { this.code = code; return this; },
      json(body) { resolve({ code: this.code, body }); },
    }, reject);
  });
  return { request, seen };
}

test('authenticated patient can read orderable pharmacy prices without private inventory fields', async () => {
  const { request, seen } = setup();
  const result = await request(`/ordering/${pharmacyId}`);
  assert.equal(result.code, 200);
  assert.deepEqual(Object.keys(result.body.items[0]).sort(), ['drugId', 'drugName', 'price']);
  assert.equal(result.body.items[0].price, 12.5);
  assert.equal(seen.inventory.pharmacyId, pharmacyId);
  assert.equal(seen.inventory.isActive, true);
  assert.equal(seen.inventory.isAvailable, true);
  assert.equal(seen.inventory.quantity.$gt, 0);
  assert.equal(seen.pharmacy.activationStatus, 'active');
  assert.equal(seen.pharmacy.patientOrderingEnabled.$ne, false);
  assert.equal(seen.inventoryFields, 'drugId drugName price priceSource');
});

test('checkout queries only selected drug IDs/names and bounds request size', async () => {
  const { request, seen } = setup();
  const body = { items: [{ id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Medicine (500mg)' }] };
  const result = await request(`/ordering/${pharmacyId}`, 'User', 'POST', 'patient-id', body);
  assert.equal(result.code, 200);
  assert.equal(seen.inventory.$or[0].drugId.$in[0], body.items[0].id);
  const pattern = seen.inventory.$or[1].drugName.$in[0];
  assert.equal(pattern.test('Medicine (500mg)'), true);
  assert.equal(pattern.test('Medicine 500mg'), false);
  assert.equal(seen.legacy.$or[1]._id.$in[0], body.items[0].id);
  assert.equal((await request(`/ordering/${pharmacyId}`, 'User', 'POST', 'patient-id')).code, 400);
  assert.equal((await request(`/ordering/${pharmacyId}`, 'User', 'POST', 'patient-id', { items: Array(101).fill(body.items[0]) })).code, 400);
});

test('older Product stock supplies selling prices, without replacing modern inventory prices', async () => {
  const { request, seen } = setup({ legacy: [
    { _id: 'old-1', drugId: 'drug-2', name: 'Legacy medicine', price: 8, costPrice: 1 },
    { _id: 'old-2', drugId: 'drug-1', name: 'Duplicate medicine', price: 99 },
  ] });
  const result = await request(`/ordering/${pharmacyId}`);
  assert.equal(result.code, 200);
  assert.equal(result.body.items.length, 2);
  assert.equal(result.body.items.find(item => item.drugId === 'drug-1').price, 12.5);
  const legacy = result.body.items.find(item => item.drugId === 'drug-2');
  assert.equal(legacy.price, 8);
  assert.equal(legacy.costPrice, undefined);
  assert.equal(seen.legacy.pharmacyId, pharmacyId);
  assert.equal(seen.legacy.amount.$gt, 0);
  assert.equal(seen.legacy.isActive, true);
});

test('legacy auto-assigned zero is replaced by catalog selling price in patient checkout response', async () => {
  const { request } = setup({ inventory: [
    { drugId: { _id: 'drug-1', unitSellingPrice: 27.5 }, drugName: 'Medicine', price: 0 },
    { drugId: { _id: 'drug-2' }, drugName: 'Unpriced medicine', price: 0 },
    { drugId: { _id: 'drug-3', unitSellingPrice: 20 }, drugName: 'Free medicine', price: 0, priceSource: 'manual' },
  ] });
  const result = await request(`/ordering/${pharmacyId}`);
  assert.equal(result.code, 200);
  assert.equal(result.body.items[0].drugId, 'drug-1');
  assert.equal(result.body.items[0].price, 27.5);
  assert.equal(result.body.items[1].price, null);
  assert.equal(result.body.items[2].price, 0);
});

test('pricing requires authentication, patient role, valid pharmacy ID and an enabled pharmacy', async () => {
  const { request } = setup();
  assert.equal((await request(`/ordering/${pharmacyId}`, null)).code, 401);
  assert.equal((await request(`/ordering/${pharmacyId}`, 'Doctor')).code, 403);
  assert.equal((await request('/ordering/invalid')).code, 400);
  assert.equal((await setup({ available: false }).request(`/ordering/${pharmacyId}`)).code, 404);
});

test('patients still cannot read or modify management inventory; owner retains access', async () => {
  const { request } = setup();
  assert.equal((await request(`/pharmacy/${pharmacyId}`)).code, 403);
  assert.equal((await request(`/pharmacy/${pharmacyId}/add`, 'User', 'POST')).code, 403);
  assert.equal((await request(`/pharmacy/${pharmacyId}/drug/b`, 'User', 'PUT')).code, 403);
  assert.equal((await request(`/pharmacy/${pharmacyId}/drug/b`, 'User', 'DELETE')).code, 403);
  assert.equal((await request(`/pharmacy/${pharmacyId}`, 'Pharmacy', 'GET', pharmacyId)).code, 200);
  assert.equal((await request(`/pharmacy/${pharmacyId}`, 'Pharmacy', 'GET', 'another-owner')).code, 403);
});
