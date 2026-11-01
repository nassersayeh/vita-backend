const { test } = require('node:test');
const assert = require('node:assert/strict');
const { priceItem, requestAccounting, monthlyAccounts } = require('../utils/laboratoryAccounting');

test('commission is calculated per test after discount and rounded in cents', () => {
  const item = priceItem({ name: 'CBC', price: 30, discountPercentage: 10 });
  assert.equal(item.originalCost, 30);
  assert.equal(item.discountAmount, 3);
  assert.equal(item.price, 27);
  assert.equal(item.vitaCommissionAmount, 1.35);
  assert.equal(item.providerNetAmount, 25.65);
  for (const price of [0, 0.1, 0.29, 19.99, 30.01, 150]) {
    const row = priceItem({ name: 'Test', price });
    assert.equal(Math.round(row.vitaCommissionAmount * 100) + Math.round(row.providerNetAmount * 100), Math.round(row.price * 100));
  }
});
test('legacy prices are supported and stored commission snapshots are preserved', () => {
  const legacy = requestAccounting({ tests: ['CBC'], pricing: [{ name: 'CBC', price: 30 }] });
  assert.equal(legacy.totalCost, 30); assert.equal(legacy.vitaCommissionAmount, 1.5);
  const snapshot = requestAccounting({ tests: ['CBC'], pricing: [{ name: 'CBC', price: 30, originalCost: 30, vitaCommissionPercent: 7, vitaCommissionAmount: 2.1, providerNetAmount: 27.9 }] });
  assert.equal(snapshot.vitaCommissionAmount, 2.1);
  assert.equal(snapshot.items[0].vitaCommissionPercent, 7);
});
test('monthly totals reconcile per-test amounts and flag unpriced referrals', () => {
  const report = monthlyAccounts([
    { _id: 'A', tests: ['CBC', 'TSH'], pricing: [priceItem({ name: 'CBC', price: 30 }), priceItem({ name: 'TSH', price: 60, discountPercentage: 10 })] },
    { _id: 'B', tests: ['Unknown'], pricing: [] },
    { _id: 'C', tests: ['Free'], pricing: [priceItem({ name: 'Free', price: 0 })] },
  ]);
  assert.equal(report.summary.completedReferrals, 3); assert.equal(report.summary.testCount, 4);
  assert.equal(report.summary.unpricedReferrals, 1);
  assert.equal(report.summary.grossIncome, 84); assert.equal(report.summary.vitaCommission, 4.2);
  assert.equal(report.summary.laboratoryNetIncome, 79.8);
});
