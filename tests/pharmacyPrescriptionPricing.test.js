const { test } = require('node:test');
const assert = require('node:assert/strict');
const { activePrescriptionFilter, buildPrescriptionQuote } = require('../utils/pharmacyPrescriptionPricing');
const products = [{ _id: 'a', quantity: 3 }, { _id: 'b', quantity: 2 }];
const prices = [{ prescriptionProductId: 'b', originalPrice: 5, discountedPrice: 5 }, { prescriptionProductId: 'a', originalPrice: 10, discountedPrice: 8 }];
test('matches lines by ID and accounts for quantity in totals and commission', () => {
  const quote = buildPrescriptionQuote(products, prices);
  assert.equal(quote.originalTotal, 40);
  assert.equal(quote.discountedTotal, 34);
  assert.equal(quote.vitaCommissionTotal, 0.68);
  assert.equal(quote.items[0].discountPercentage, 20);
});
test('rejects missing, duplicate, foreign and malformed price lines', () => {
  for (const items of [[], [prices[0], prices[0]], [prices[0], { ...prices[1], prescriptionProductId: 'other' }], [null, prices[1]]]) {
    assert.throws(() => buildPrescriptionQuote(products, items), /INVALID_PRICE/);
  }
  for (const value of ['', ' ', null, false, -1, Infinity, 'abc', 11]) {
    assert.throws(() => buildPrescriptionQuote(products, [prices[0], { ...prices[1], discountedPrice: value }]), /INVALID_PRICE/);
  }
});
test('allows zero price and full discounts; rejects invalid quantities', () => {
  assert.equal(buildPrescriptionQuote([{ _id: 'a' }], [{ prescriptionProductId: 'a', originalPrice: 10, discountedPrice: 0 }]).discountedTotal, 0);
  for (const quantity of [0, -1, 1.5]) assert.throws(() => buildPrescriptionQuote([{ _id: 'a', quantity }], [prices[1]]), /INVALID_PRICE/);
});
test('active filter excludes dispensed, expired and unpublished prescriptions', () => {
  const now = new Date('2026-09-23');
  const filter = activePrescriptionFilter(now);
  assert.equal(filter.dispensedAt, null);
  assert.equal(filter.isValid, true);
  assert.deepEqual(filter.dispensedCount, { $in: [0, null] });
  assert.deepEqual(filter.workflowStatus, { $ne: 'pending_secretary' });
  assert.deepEqual(filter.$or, [{ expiryDate: null }, { expiryDate: { $gt: now } }]);
});
