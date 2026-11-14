const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dispenseUploadedOrder } = require('../utils/dispenseUploadedOrder');
const orderId = '111111111111111111111111', drugId = '222222222222222222222222', otherId = '333333333333333333333333';
const pharmacy = { _id: '444444444444444444444444', role: 'Pharmacy', activationStatus: 'active', patientOrderingEnabled: true, prescriptionDispensingEnabled: true, country: 'Palestine' };
const line = { drugId, quantity: 2, price: '12.35', isSubstitute: true, originalDrugName: ' Original medicine ' };
function fixture() {
  const order = { _id: orderId, pharmacyId: pharmacy._id, user: otherId, status: 'pending', orderType: 'upload', adminApprovalStatus: 'approved', prescriptionImage: { fileUrl: '/photo.jpg' }, deliveryFee: 0 };
  const writes = [], guards = [];
  let committed = false;
  const models = {
    Order: { findOne: filter => { assert.equal(filter.pharmacyId, pharmacy._id); assert.equal(filter.adminApprovalStatus, 'approved'); return { lean: async () => committed ? null : order }; }, findOneAndUpdate: async (filter, update, options) => { assert.equal(filter.status, 'pending'); assert.equal(filter.dispensedAt, null); assert.equal(options.runValidators, true); if (committed) return null; committed = true; writes.push(update); return { ...order, ...update.$set }; } },
    Drug: { find: () => ({ select: () => ({ lean: async () => [{ _id: drugId, name: 'Catalog medicine' }] }) }) },
    guard: async (...args) => { guards.push(args); },
  };
  return { models, writes, guards, order };
}
test('photo dispensing persists catalog identity, substitute and commission as a completed sale', async () => {
  const f = fixture();
  const result = await dispenseUploadedOrder({ orderId, pharmacy, lines: [line] }, f.models);
  assert.equal(result.items[0].name, 'Catalog medicine');
  assert.equal(result.items[0].drugId, drugId);
  assert.equal(result.items[0].isSubstitute, true);
  assert.equal(result.items[0].originalDrugName, 'Original medicine');
  assert.equal(result.total, 24.7);
  assert.equal(result.vitaCommissionAmount, 0.49);
  assert.equal(result.status, 'completed');
  assert.ok(result.dispensedAt instanceof Date);
  assert.equal(result.deliveredAt, result.dispensedAt);
  assert.equal(result.pharmacyPricedAt, result.dispensedAt);
  assert.equal(f.guards.length, 1);
  assert.equal(f.writes.length, 1);
});
test('substitute original name is optional and cleared for ordinary items', async () => {
  for (const isSubstitute of [true, false]) {
    const f = fixture();
    const result = await dispenseUploadedOrder({ orderId, pharmacy, lines: [{ ...line, isSubstitute, originalDrugName: isSubstitute ? '' : 'ignore me' }] }, f.models);
    assert.equal(result.items[0].originalDrugName, '');
  }
});
test('invalid quantities, prices, drugs, substitute flags and duplicate lines never write a sale', async () => {
  const variants = [[], [line, line], [{ ...line, drugId: 'invalid' }], [{ ...line, drugId: otherId }], ...[0, -1, 1.5, 10001, '2', true].map(quantity => [{ ...line, quantity }]), ...['', -1, true, null, Infinity, 1000001, 1.234].map(price => [{ ...line, price }]), [{ ...line, isSubstitute: 'true' }], [{ ...line, originalDrugName: 'x'.repeat(301) }]];
  for (const lines of variants) {
    const f = fixture();
    await assert.rejects(dispenseUploadedOrder({ orderId, pharmacy, lines }, f.models), e => e.status === 400);
    assert.equal(f.writes.length, 0);
  }
});
test('only an enabled pharmacy can dispense and only its approved photo order', async () => {
  for (const badPharmacy of [{ ...pharmacy, role: 'User' }, { ...pharmacy, activationStatus: 'pending' }, { ...pharmacy, patientOrderingEnabled: false }, { ...pharmacy, prescriptionDispensingEnabled: false }]) {
    const f = fixture();
    await assert.rejects(dispenseUploadedOrder({ orderId, pharmacy: badPharmacy, lines: [line] }, f.models), e => e.status === 403);
    assert.equal(f.writes.length, 0);
  }
  const f = fixture(); f.models.Order.findOne = () => ({ lean: async () => null });
  await assert.rejects(dispenseUploadedOrder({ orderId, pharmacy, lines: [line] }, f.models), e => e.status === 409);
});
test('regulated drug rejection happens before committing the order', async () => {
  const f = fixture(); f.models.guard = async () => { throw Object.assign(new Error('Controlled workflow required'), { status: 403 }); };
  await assert.rejects(dispenseUploadedOrder({ orderId, pharmacy, lines: [line] }, f.models), e => e.status === 403);
  assert.equal(f.writes.length, 0);
});
test('concurrent dispensing and retries commit exactly once', async () => {
  const f = fixture();
  const results = await Promise.allSettled([1, 2].map(() => dispenseUploadedOrder({ orderId, pharmacy, lines: [line] }, f.models)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  await assert.rejects(dispenseUploadedOrder({ orderId, pharmacy, lines: [line] }, f.models), e => e.status === 409);
  assert.equal(f.writes.length, 1);
});

test('uploaded medicines retain original prices and commission uses only discounted subtotal', async () => {
  const f = fixture(); f.order.deliveryFee = 10;
  const result = await dispenseUploadedOrder({ orderId, pharmacy, lines: [{ ...line, originalPrice: '20.00', price: '15.00', quantity: 3 }] }, f.models);
  assert.equal(result.items[0].originalPrice, 20);
  assert.equal(result.items[0].price, 15);
  assert.equal(result.originalSubtotal, 60);
  assert.equal(result.subtotal, 45);
  assert.equal(result.originalTotal, 70);
  assert.equal(result.total, 55);
  assert.equal(result.discountAmount, 15);
  assert.equal(result.discountPercentage, 25);
  assert.equal(result.vitaCommissionAmount, 0.9);
});

test('missing original prices keep older clients compatible while explicit invalid prices are rejected', async () => {
  const f = fixture();
  const unchanged = await dispenseUploadedOrder({ orderId, pharmacy, lines: [line] }, f.models);
  assert.equal(unchanged.items[0].originalPrice, Number(line.price));
  assert.equal(unchanged.discountAmount, 0);
  for (const originalPrice of ['', null, true, false, -1, Infinity, 1000001, 12.351, 12]) {
    const f = fixture();
    await assert.rejects(dispenseUploadedOrder({ orderId, pharmacy, lines: [{ ...line, originalPrice }] }, f.models), e => e.status === 400);
    assert.equal(f.writes.length, 0);
  }
});

test('fully discounted medicines are valid and produce zero medicine commission', async () => {
  const f = fixture();
  const result = await dispenseUploadedOrder({ orderId, pharmacy, lines: [{ ...line, originalPrice: 10, price: 0 }] }, f.models);
  assert.equal(result.originalSubtotal, 20);
  assert.equal(result.total, 0);
  assert.equal(result.discountAmount, 20);
  assert.equal(result.vitaCommissionAmount, 0);
});
