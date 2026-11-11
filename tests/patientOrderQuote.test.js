const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPatientOrderQuote } = require('../utils/patientOrderQuote');
const { prescriptionBlockingOrders } = require('../utils/patientPrescriptionEligibility');

test('discounted unit prices preserve original totals and keep delivery outside the discount', () => {
  const items = [{ price: 12, quantity: 2, name: 'Medicine' }, { price: 10, quantity: 1, name: 'Other' }];
  const quote = buildPatientOrderQuote(items, [{ index: 1, discountedPrice: 8 }, { index: 0, discountedPrice: 9 }], 15);
  assert.equal(quote.originalSubtotal, 34);
  assert.equal(quote.subtotal, 26);
  assert.equal(quote.originalTotal, 49);
  assert.equal(quote.total, 41);
  assert.equal(quote.discountAmount, 8);
  assert.equal(quote.discountPercentage, 23.53);
  assert.equal(quote.vitaCommissionAmount, 0.52);
  assert.equal(quote.vitaCommissionPercent, 2);
  assert.equal(quote.items[0].originalPrice, 12);
  assert.equal(quote.items[0].price, 9);
  assert.equal(items[0].price, 12);
});

test('pharmacy can enter original prices and commission excludes delivery', () => {
  const items = [{ price: 0, quantity: 3 }];
  const quote = buildPatientOrderQuote(items, [{ index: 0, originalPrice: 20, discountedPrice: 15 }], 10);
  assert.equal(quote.originalSubtotal, 60);
  assert.equal(quote.total, 55);
  assert.equal(quote.vitaCommissionAmount, 0.9);
  for (const originalPrice of ['', null, true, -1, Infinity, 1000001]) {
    assert.throws(() => buildPatientOrderQuote(items, [{ index: 0, originalPrice, discountedPrice: 1 }], 10));
  }
});

test('missing, duplicate, foreign and invalid discount lines never create a partial quote', () => {
  const items = [{ price: 12, quantity: 1 }];
  for (const prices of [[], [{ index: 0, discountedPrice: 13 }], [{ index: 1, discountedPrice: 5 }], [{ index: 0, discountedPrice: '' }], [{ index: 0, discountedPrice: -1 }], [{ index: 0, discountedPrice: null }]]) {
    assert.throws(() => buildPatientOrderQuote(items, prices, 15), error => error.status === 400);
  }
  assert.equal(buildPatientOrderQuote(items, [{ index: 0, discountedPrice: 0 }], 15).total, 15);
});

test('cancelled requests release the prescription while fulfillment history still blocks reuse', () => {
  const filter = prescriptionBlockingOrders();
  const released = filter.$nor[0];
  assert.deepEqual(released.status.$in, ['cancelled', 'declined']);
  assert.deepEqual(released['statusHistory.status'].$nin, ['delivered', 'completed', 'paid']);
});
