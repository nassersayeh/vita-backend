const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const patientId = '111111111111111111111111';
function setup() {
  let reads = 0, filter;
  const sample = { _id: 'order', items: [{ name: 'Dispensed medicine', quantity: 1, isSubstitute: true, originalDrugName: 'Original' }], dispensedAt: new Date() };
  const query = { select() { return this; }, populate() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [sample] };
  const Order = { find(f) { reads++; filter = f; return query; }, countDocuments: async () => 1 };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/uploadedOrderController'), 'utf8'), { module, exports: module.exports, console, require: name => name === '../models/Order' ? Order : {} });
  const request = async (user, page) => { const res = { code: 200, status(c) { this.code = c; return this; }, json(body) { this.body = body; return this; } }; await module.exports.history({ user, params: { patientId }, query: { page } }, res); return res; };
  return { request, reads: () => reads, filter: () => filter };
}
test('only patient self and linked doctors can read uploaded dispensing history', async () => {
  for (const user of [{ role: 'User', _id: patientId }, { role: 'Doctor', _id: 'doctor', patients: [patientId] }]) {
    const f = setup(), res = await f.request(user);
    assert.equal(res.code, 200);
    assert.equal(res.body.orders[0].items[0].isSubstitute, true);
    assert.equal(res.body.orders[0].items[0].originalDrugName, 'Original');
    assert.equal(f.filter().user, patientId);
    assert.equal(f.filter().status, 'completed');
    assert.equal(f.filter().adminApprovalStatus, 'approved');
    assert.equal(f.filter().dispensedAt.$type, 'date');
  }
  for (const user of [{ role: 'User', _id: 'other' }, { role: 'Doctor', patients: [] }, { role: 'Pharmacy', patients: [patientId] }]) {
    const f = setup(), res = await f.request(user);
    assert.equal(res.code, 403);
    assert.equal(f.reads(), 0);
  }
});
test('invalid pagination cannot query patient history', async () => {
  for (const page of ['0', '-1', '1.5', 'invalid', '100001']) {
    const f = setup(), res = await f.request({ role: 'User', _id: patientId }, page);
    assert.equal(res.code, 400);
    assert.equal(f.reads(), 0);
  }
});
