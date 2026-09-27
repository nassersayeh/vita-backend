const { test } = require('node:test');
const assert = require('node:assert/strict');
const { saveStandalonePrescription } = require('../utils/saveStandalonePrescription');

function fixture(quantities = [8, 8]) {
  const state = {
    prescription: { _id: 'rx', products: [{ _id: 'a', drugId: 'd1', quantity: 2 }, { _id: 'b', drugId: 'd2', quantity: 2 }] },
    inventory: quantities.map((quantity, index) => ({ _id: `d${index + 1}`, quantity, soldCount: 0 })),
    quote: null,
  };
  const Prescription = {
    async findOneAndUpdate(filter, update) {
      if (state.prescription.pharmacyWriteLock || state.prescription.dispensedAt) return null;
      assert.equal(filter.pharmacyWriteLock, null);
      state.prescription.pharmacyWriteLock = update.$set.pharmacyWriteLock;
      return structuredClone(state.prescription);
    },
    async updateOne(filter, update) {
      if (state.prescription.pharmacyWriteLock?.token !== filter['pharmacyWriteLock.token']) return { modifiedCount: 0 };
      delete state.prescription.pharmacyWriteLock;
      Object.assign(state.prescription, update.$set);
      if (update.$inc) state.prescription.dispensedCount = (state.prescription.dispensedCount || 0) + update.$inc.dispensedCount;
      return { modifiedCount: 1 };
    },
  };
  const Inventory = {
    async findOneAndUpdate(filter, update) {
      const stock = state.inventory.find(item => item._id === filter.drugId);
      if (!stock || stock.quantity < filter.quantity.$gte) return null;
      stock.quantity += update.$inc.quantity;
      stock.soldCount += update.$inc.soldCount;
      return structuredClone(stock);
    },
    async updateOne(filter, update) {
      const stock = state.inventory.find(item => item._id === filter._id);
      if (!stock) return { modifiedCount: 0 };
      stock.quantity += update.$inc.quantity;
      stock.soldCount += update.$inc.soldCount;
      return { modifiedCount: 1 };
    },
  };
  const Quote = {
    findOne: () => ({ lean: async () => structuredClone(state.quote) }),
    async findOneAndUpdate(filter, update) { state.quote = structuredClone(update); return state.quote; },
    async updateOne(filter, update) { Object.assign(state.quote, update.$set); },
    async deleteOne() { state.quote = null; },
  };
  const args = { Prescription, Inventory, Quote, prescriptionId: 'rx', pharmacyId: 'pharmacy', items: [{ prescriptionProductId: 'a', originalPrice: 10, discountedPrice: 8 }, { prescriptionProductId: 'b', originalPrice: 10, discountedPrice: 8 }] };
  return { state, args };
}

test('standalone pricing saves unit prices and totals without changing inventory', async () => {
  const { state, args } = fixture();
  const quote = await saveStandalonePrescription({ ...args, dispense: false });
  assert.equal(quote.discountedTotal, 32);
  assert.equal(quote.status, 'priced');
  assert.deepEqual(state.inventory.map(item => item.quantity), [8, 8]);
  assert.ok(!state.prescription.pharmacyWriteLock);
});
test('dispense commits stock, quote and status and prevents a duplicate request', async () => {
  const { state, args } = fixture();
  assert.equal((await saveStandalonePrescription({ ...args, dispense: true })).status, 'dispensed');
  assert.deepEqual(state.inventory.map(item => item.quantity), [6, 6]);
  assert.equal(state.prescription.dispensedCount, 1);
  assert.equal(state.prescription.dispensedBy, 'pharmacy');
  await assert.rejects(saveStandalonePrescription({ ...args, dispense: true }), /UNAVAILABLE/);
});
test('insufficient later medicine restores earlier stock and leaves saved pricing intact', async () => {
  const { state, args } = fixture([8, 1]);
  await saveStandalonePrescription({ ...args, dispense: false });
  await assert.rejects(saveStandalonePrescription({ ...args, dispense: true }), /STOCK/);
  assert.deepEqual(state.inventory.map(item => item.quantity), [8, 1]);
  assert.deepEqual(state.inventory.map(item => item.soldCount), [0, 0]);
  assert.equal(state.quote.status, 'priced');
  assert.ok(!state.prescription.pharmacyWriteLock);
  assert.ok(!state.prescription.dispensedAt);
});
test('concurrent requests cannot deduct the same prescription twice', async () => {
  const { state, args } = fixture();
  const results = await Promise.allSettled([saveStandalonePrescription({ ...args, dispense: true }), saveStandalonePrescription({ ...args, dispense: true })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.deepEqual(state.inventory.map(item => item.quantity), [6, 6]);
});
test('invalid pricing releases the lock for a corrected retry', async () => {
  const { state, args } = fixture();
  await assert.rejects(saveStandalonePrescription({ ...args, items: [], dispense: false }), /INVALID_PRICE/);
  assert.ok(!state.prescription.pharmacyWriteLock);
  await saveStandalonePrescription({ ...args, dispense: false });
});
test('duplicate drug lines are aggregated before checking stock', async () => {
  const { state, args } = fixture([3, 8]);
  state.prescription.products[1].drugId = 'd1';
  await assert.rejects(saveStandalonePrescription({ ...args, dispense: true }), /STOCK/);
  assert.equal(state.inventory[0].quantity, 3);
});
test('unknown database failure retains the lock rather than risking double dispensing', async () => {
  const { state, args } = fixture();
  args.Quote.findOneAndUpdate = async () => { throw new Error('Disconnected'); };
  await assert.rejects(saveStandalonePrescription({ ...args, dispense: true }), /RECOVERY_REQUIRED/);
  assert.ok(state.prescription.pharmacyWriteLock);
  await assert.rejects(saveStandalonePrescription({ ...args, dispense: true }), /UNAVAILABLE/);
});
test('expiry at final commit rolls pricing and inventory back', async () => {
  const { state, args } = fixture();
  const update = args.Prescription.updateOne;
  args.Prescription.updateOne = (filter, changes) => filter.isValid ? { modifiedCount: 0 } : update(filter, changes);
  await assert.rejects(saveStandalonePrescription({ ...args, dispense: true }), /UNAVAILABLE/);
  assert.deepEqual(state.inventory.map(item => item.quantity), [8, 8]);
  assert.equal(state.quote, null);
  assert.ok(!state.prescription.pharmacyWriteLock);
});
test('revoked controlled permission before commit restores pricing and inventory', async () => {
  const { state, args } = fixture();
  await assert.rejects(saveStandalonePrescription({ ...args, dispense: true, beforeCommit: async () => { throw new Error('Ministry suspension'); } }), /Ministry suspension/);
  assert.deepEqual(state.inventory.map(item => item.quantity), [8, 8]);
  assert.equal(state.quote, null);
  assert.ok(!state.prescription.dispensedAt);
  assert.ok(!state.prescription.pharmacyWriteLock);
});
