const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const id = 'aaaaaaaaaaaaaaaaaaaaaaaa';
function setup(role) {
  const seen = {};
  const chain = data => ({ select() { return this; }, skip(value) { seen.skip = value; return this; }, limit(value) { seen.limit = value; return this; }, maxTimeMS() { return this; }, populate(options) { seen.populate = options; return this; }, sort() { return this; }, lean: async () => data });
  const mocks = {
    '../models/User': { findOne: filter => { seen.filter = filter; const data = { _id: id, role, fullName: 'Provider' }; return { select() { return this; }, lean: async () => data, then: (resolve, reject) => Promise.resolve(data).then(resolve, reject) }; } },
    '../models/DoctorPatientRequest': {},
    mongoose: { isValidObjectId: value => /^[a-f0-9]{24}$/.test(value) },
    '../models/PharmacyInventory': { find: filter => { seen.inventoryFilter = filter; return chain(Array.from({ length: 21 }, () => ({ drugId: { _id: id, name: 'Medicine', unitSellingPrice: 12 }, quantity: 99, costPrice: 2 }))); } },
    '../models/MedicalTest': { find: filter => { seen.services = filter; return chain([{ _id: id, name: 'Test', price: 100 }]); } },
    '../utils/patientServiceBooking': require('../utils/patientServiceBooking'),
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/providerController'), 'utf8'), { module, exports: module.exports, require: name => mocks[name], console });
  return { seen, get: async (type, value = id) => {
    const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await module.exports.getProviderDetails({ params: { id: value }, query: { type } }, response);
    return response;
  }, medicines: async (page, search) => {
    const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await module.exports.getProviderMedicines({ params: { id }, query: { page, search } }, response);
    return response;
  } };
}
test('pharmacy profile excludes inventory so opening it never loads the full catalog', async () => {
  const { get, seen } = setup('Pharmacy'); const res = await get('pharmacy');
  assert.equal(seen.filter.role.$in[0], 'Pharmacy');
  assert.equal(res.body.data.inventory, undefined);
  assert.equal(seen.populate, undefined);
});
test('lab and radiology profiles only load the correct provider-owned published services', async () => {
  for (const [role, type] of [['Lab', 'laboratory'], ['Radiology', 'radiology']]) {
    const { get, seen } = setup(role); const res = await get(type);
    assert.equal(seen.filter.role.$in[0], role);
    assert.equal(seen.services.type, type); assert.equal(seen.services.isActive, true);
    assert.equal(seen.services.$or[0].providerId, id);
    assert.equal(res.body.data.services[0].name, 'Test');
  }
});
test('malformed provider ids return 400', async () => {
  const { get } = setup('Pharmacy'); assert.equal((await get('pharmacy', 'invalid')).code, 400);
});

test('medicine pages are bounded and use central prices without private stock', async () => {
 const { medicines, seen } = setup('Pharmacy'); const result = await medicines(2, 'Drug.*');
 assert.equal(result.body.medicines.length, 20); assert.equal(result.body.hasMore, true);
 assert.equal(seen.inventoryFilter.drugName.$regex, 'Drug\\.\\*');
 assert.equal(seen.limit, 21); assert.equal(seen.skip, 20);
 assert.equal(result.body.medicines[0].price, 12);
 assert.equal(result.body.medicines[0].quantity, undefined);
});
