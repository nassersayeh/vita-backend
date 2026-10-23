const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createCatalogService, catalogInput } = require('../utils/sharedDrugCatalog');
function fixture(initial = []) {
  const rows = initial.map((row, i) => ({ _id: String(i + 1).padStart(24, '0'), isActive: true, ...row }));
  const locks = new Map();
  const Drug = {
    find(filter) {
      const found = rows.filter(row => (!filter.isActive || row.isActive) && (filter.barcode === undefined || row.barcode === filter.barcode) && (!filter.name || filter.name.test(row.name)));
      return Object.assign(Promise.resolve(found.map(row => ({ ...row }))), { limit: n => Promise.resolve(found.slice(0, n).map(row => ({ ...row }))) });
    },
    async create(data) { const row = { _id: String(rows.length + 1).padStart(24, '0'), ...data }; rows.push(row); return { ...row }; },
    async findOneAndUpdate(filter, update) {
      const row = rows.find(row => row._id === filter._id && (typeof filter.barcode === 'object' ? row.barcode == null || row.barcode === '' : row.barcode === filter.barcode));
      if (!row) return null;
      Object.assign(row, update.$set); for (const key of Object.keys(update.$unset || {})) delete row[key]; return { ...row };
    },
  };
  const Lock = {
    async findOneAndUpdate(filter, update) {
      if (locks.has(filter._id) && locks.get(filter._id).expiresAt >= filter.expiresAt.$lt) throw Object.assign(Error('Locked'), { code: 11000 });
      locks.set(filter._id, update.$set); return update.$set;
    },
    async deleteMany(filter) { for (const key of filter._id.$in) if (locks.get(key)?.token === filter.token) locks.delete(key); },
  };
  return { resolve: createCatalogService(Drug, Lock), Drug, Lock, rows, locks };
}
test('doctor creates a shared medicine without price, barcode, stock or cost', async () => {
  const f = fixture();
  const result = await f.resolve({ name: 'Trade', genericName: 'Scientific', costPrice: 10, quantity: 50, ownerPharmacyId: 'forged', isActive: false });
  assert.equal(result.created, true); assert.equal(result.drug.isCustom, false); assert.equal(result.drug.isActive, true);
  for (const key of ['barcode', 'unitSellingPrice', 'costPrice', 'quantity', 'ownerPharmacyId']) assert.equal(result.drug[key], undefined);
  assert.equal(f.locks.size, 0);
});
test('pharmacy attaches barcode and missing metadata to the original doctor ID', async () => {
  const f = fixture(); const first = await f.resolve({ name: 'Trade', genericName: 'Scientific' });
  const linked = await f.resolve({ name: ' trade ', genericName: 'scientific', barcode: '00001234', strength: '500mg', dosageForm: 'tablet', price: 20, costPrice: 5 });
  assert.equal(linked.drug._id, first.drug._id); assert.equal(linked.linked, true); assert.equal(f.rows.length, 1);
  assert.equal(linked.drug.barcode, '00001234'); assert.equal(linked.drug.unitSellingPrice, 20); assert.equal(linked.drug.costPrice, undefined);
  assert.equal((await f.resolve({ name: 'Trade', genericName: 'Scientific' })).drug._id, first.drug._id);
});
test('known barcode reuses canonical medicine, preserves catalog price, and rejects another selected ID', async () => {
  const f = fixture([{ name: 'Trade', genericName: 'Scientific', barcode: '1234', unitSellingPrice: 9 }]);
  assert.equal((await f.resolve({ name: 'Other', barcode: '1234', price: 100 })).drug.unitSellingPrice, 9);
  assert.equal(f.rows.length, 1);
  await assert.rejects(f.resolve({ name: 'Trade', barcode: '1234', drugId: 'ffffffffffffffffffffffff' }), { status: 409 });
});
test('escaped names, case and repeated whitespace match literally', async () => {
  const f = fixture([{ name: 'Brand+  Plus (500)', genericName: 'Ingredient' }]);
  const result = await f.resolve({ name: ' brand+ plus (500) ', genericName: 'Ingredient', barcode: '99' });
  assert.equal(result.linked, true); assert.equal(f.rows.length, 1);
});
test('never guesses ambiguous names or overwrites an existing barcode', async () => {
  const f = fixture([{ name: 'Trade', genericName: 'Scientific', strength: '100mg' }, { name: 'Trade', genericName: 'Scientific', strength: '200mg' }]);
  await assert.rejects(f.resolve({ name: 'Trade', genericName: 'Scientific', barcode: '1' }), { status: 409 });
  const chosen = await f.resolve({ name: 'Trade', genericName: 'Scientific', drugId: f.rows[1]._id, barcode: '1' });
  assert.equal(chosen.drug.strength, '200mg');
  await assert.rejects(f.resolve({ name: 'Trade', genericName: 'Scientific', strength: '200mg', barcode: '2' }), { status: 409 });
  assert.equal(f.locks.size, 0);
});
test('different scientific ingredients, strengths and dosage forms are not merged', async () => {
  for (const data of [{ genericName: 'Other' }, { genericName: 'Scientific', strength: '200mg' }, { genericName: 'Scientific', dosageForm: 'syrup' }]) {
    const f = fixture([{ name: 'Trade', genericName: 'Scientific', strength: '100mg', dosageForm: 'tablet' }]);
    const res = await f.resolve({ name: 'Trade', ...data }); assert.equal(res.created, true);
    assert.equal(f.rows.length, 2);
  }
});
test('simultaneous doctor and pharmacies create only one identity and one barcode', async () => {
  const f = fixture();
  const results = await Promise.all([
    f.resolve({ name: 'Trade', genericName: 'Scientific' }),
    f.resolve({ name: 'TRADE', genericName: 'Scientific', barcode: '0001', price: 20 }),
    f.resolve({ name: 'Trade', genericName: 'Scientific', barcode: '0001', price: 25 }),
  ]);
  assert.equal(f.rows.length, 1); assert.equal(new Set(results.map(r => r.drug._id)).size, 1); assert.equal(f.rows[0].barcode, '0001');
  assert.equal(f.locks.size, 0);
});
test('rejects invalid input before catalog writes', async () => {
  const f = fixture();
  for (const data of [{}, { name: {} }, { name: 'Trade', genericName: [] }, { name: 'Trade', genericName: 'Scientific', price: -1 }, { name: 'Trade', genericName: 'Scientific', price: 'abc' }, { name: 'Trade', genericName: 'Scientific', price: false }]) await assert.rejects(f.resolve(data), { status: 400 });
  assert.equal(f.rows.length, 0); assert.equal(f.locks.size, 0);
  assert.equal(catalogInput({ name: 'Trade', price: 0 }).unitSellingPrice, 0);
});
function inventoryController(f, inventories) {
  const module = { exports: {} };
  const Inventory = {
    async findOneAndUpdate(filter, update) {
      let row = inventories.find(row => row.drugId === filter.drugId && row.pharmacyId === filter.pharmacyId);
      if (!row) { row = { _id: 'stock', ...filter }; inventories.push(row); }
      Object.assign(row, update.$set); row.populate = async () => row; return row;
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/pharmacyInventoryController'), 'utf8'), { module, exports: module.exports, console, require: name => ({ '../models/PharmacyInventory': Inventory, '../models/Drug': f.Drug, '../models/User': {}, '../models/DrugCatalogLock': f.Lock, '../utils/sharedDrugCatalog': { createCatalogService } })[name] });
  return module.exports;
}
async function add(controller, body, owner = 'pharmacy-a', pharmacyId = 'pharmacy-a') {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await controller.addManualDrugToInventory({ params: { pharmacyId }, user: { _id: owner }, body }, res); return res;
}
test('inventory is per pharmacy, absolute stock saves are retry safe, and catalog excludes private cost', async () => {
  const f = fixture(), inventories = [], controller = inventoryController(f, inventories);
  const body = { name: 'Trade', genericName: 'Scientific', barcode: '0001', quantity: 10, price: 20, costPrice: 7 };
  assert.equal((await add(controller, body)).code, 201);
  assert.equal((await add(controller, body)).code, 201);
  assert.equal(inventories.length, 1); assert.equal(inventories[0].quantity, 10); assert.equal(inventories[0].costPrice, 7); assert.equal(f.rows.length, 1); assert.equal(f.rows[0].costPrice, undefined);
  assert.equal((await add(controller, body, 'other-pharmacy')).code, 403);
  assert.equal((await add(controller, { ...body, quantity: 3, price: 30, costPrice: 11 }, 'pharmacy-b', 'pharmacy-b')).code, 201);
  assert.equal(inventories.length, 2); assert.equal(f.rows.length, 1);
  assert.equal(inventories[0].quantity, 10); assert.equal(inventories[1].quantity, 3);
  assert.equal(inventories[0].price, 20); assert.equal(inventories[1].price, 30);
  assert.equal(f.rows[0].unitSellingPrice, 20);
});
test('invalid stock cannot leave a catalog record behind', async () => {
  const f = fixture(), inventories = [], controller = inventoryController(f, inventories);
  for (const quantity of [-1, 1.5, '', null, 'abc', false]) assert.equal((await add(controller, { name: 'Trade', genericName: 'Scientific', quantity, price: 10 })).code, 400);
  assert.equal(f.rows.length, 0); assert.equal(inventories.length, 0);
});
test('shared catalog route authorizes doctors and pharmacies, excludes unrelated roles and pending accounts', async () => {
  const f = fixture(), module = { exports: {} }, filename = require.resolve('../routes/drugs'), native = createRequire(filename);
  const mocks = { '../models/Drug': f.Drug, '../models/DrugCatalogLock': f.Lock, '../models/Order': {}, fs: { mkdirSync() {} }, '../middleware/auth': (req, res, next) => req.user ? next() : res.status(401).json({ message: 'Login required' }) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console, process, require: name => name in mocks ? mocks[name] : native(name) });
  const request = user => new Promise((resolve, reject) => module.exports.handle({ method: 'POST', url: '/catalog', headers: {}, user, body: { name: 'Trade', genericName: 'Scientific' } }, { code: 200, status(code) { this.code = code; return this; }, json(body) { resolve({ code: this.code, body }); } }, reject));
  assert.equal((await request(null)).code, 401);
  for (const role of ['User', 'SalesManager', 'Lab']) assert.equal((await request({ role, activationStatus: 'active' })).code, 403);
  assert.equal((await request({ role: 'Doctor', activationStatus: 'pending' })).code, 403);
  assert.equal(f.rows.length, 0);
  assert.equal((await request({ role: 'Doctor', activationStatus: 'active' })).code, 201);
  assert.equal((await request({ role: 'Pharmacy', activationStatus: 'active' })).code, 200);
  assert.equal(f.rows.length, 1);
});
