const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const { saveStandalonePrescription } = require('../utils/saveStandalonePrescription');

// Explicit opt-in. Always uses a unique disposable database, never application data.
test('standalone prescription saving and dispensing', { skip: process.env.RUN_MONGO_INTEGRATION !== '1' }, async t => {
  require('dotenv').config({ quiet: true });
  const dbName = `vita_prescription_test_${randomUUID().replaceAll('-', '')}`;
  await mongoose.connect(process.env.MONGODB_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  const Prescription = require('../models/EPrescription');
  const Inventory = require('../models/PharmacyInventory');
  const Quote = require('../models/PharmacyPrescriptionQuote');
  const id = () => new mongoose.Types.ObjectId();
  try {
    await Promise.all([Prescription.init(), Inventory.init(), Quote.init()]);
    const setup = async (quantities = [8, 8]) => {
      const pharmacyId = id();
      const drugIds = [id(), id()];
      await Inventory.create(drugIds.map((drugId, i) => ({ pharmacyId, drugId, drugName: `Test ${i}`, quantity: quantities[i], price: 10 })));
      const prescription = await Prescription.create({ patientId: id(), doctorId: id(), workflowStatus: 'sent_to_pharmacy', expiryDate: new Date(Date.now() + 60000), products: drugIds.map(drugId => ({ drugId, name: 'Test', dose: 'Test', quantity: 2 })) });
      const items = prescription.products.map(product => ({ prescriptionProductId: product._id, originalPrice: 10, discountedPrice: 8 }));
      const args = { Prescription, Inventory, Quote, prescriptionId: prescription._id, pharmacyId, items };
      return { args, prescription, pharmacyId };
    };
    await t.test('saves prices without transactions and leaves stock unchanged', async () => {
      const { args } = await setup();
      const quote = await saveStandalonePrescription({ ...args, dispense: false });
      assert.equal(quote.discountedTotal, 32);
      assert.equal(quote.status, 'priced');
      assert.equal((await Inventory.findOne({ pharmacyId: args.pharmacyId })).quantity, 8);
      assert.ok(!(await Prescription.findById(args.prescriptionId).select('+pharmacyWriteLock')).pharmacyWriteLock);
    });
    await t.test('dispenses once, updates quantities and blocks retries', async () => {
      const { args } = await setup();
      const quote = await saveStandalonePrescription({ ...args, dispense: true });
      assert.equal(quote.status, 'dispensed');
      const prescription = await Prescription.findById(args.prescriptionId);
      assert.ok(prescription.dispensedAt);
      assert.equal(prescription.dispensedCount, 1);
      for (const stock of await Inventory.find({ pharmacyId: args.pharmacyId })) {
        assert.equal(stock.quantity, 6);
        assert.equal(stock.soldCount, 2);
      }
      await assert.rejects(saveStandalonePrescription({ ...args, dispense: true }), /UNAVAILABLE/);
    });
    await t.test('restores earlier stock deductions when another medicine is short', async () => {
      const { args } = await setup([8, 1]);
      await saveStandalonePrescription({ ...args, dispense: false });
      await assert.rejects(saveStandalonePrescription({ ...args, dispense: true }), /STOCK/);
      const stock = await Inventory.find({ pharmacyId: args.pharmacyId }).sort({ drugName: 1 });
      assert.deepEqual(stock.map(row => row.quantity), [8, 1]);
      assert.deepEqual(stock.map(row => row.soldCount), [0, 0]);
      assert.equal((await Quote.findOne({ prescription: args.prescriptionId })).status, 'priced');
      const prescription = await Prescription.findById(args.prescriptionId).select('+pharmacyWriteLock');
      assert.ok(!prescription.dispensedAt);
      assert.ok(!prescription.pharmacyWriteLock);
    });
    await t.test('concurrent dispense requests deduct stock once', async () => {
      const { args } = await setup();
      const outcomes = await Promise.allSettled([saveStandalonePrescription({ ...args, dispense: true }), saveStandalonePrescription({ ...args, dispense: true })]);
      assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal((await Inventory.findOne({ pharmacyId: args.pharmacyId })).quantity, 6);
    });
    await t.test('invalid pricing releases lock and permits corrected retry', async () => {
      const { args } = await setup();
      await assert.rejects(saveStandalonePrescription({ ...args, items: [], dispense: false }), /INVALID_PRICE/);
      assert.equal((await saveStandalonePrescription({ ...args, dispense: false })).status, 'priced');
    });
    await t.test('ambiguous write failures keep lock to prevent duplicate dispensing', async () => {
      const { args } = await setup();
      const failingInventory = { findOneAndUpdate: async () => { throw new Error('Connection lost'); } };
      await assert.rejects(saveStandalonePrescription({ ...args, Inventory: failingInventory, dispense: true }), /RECOVERY_REQUIRED/);
      assert.ok((await Prescription.findById(args.prescriptionId).select('+pharmacyWriteLock')).pharmacyWriteLock);
      await assert.rejects(saveStandalonePrescription({ ...args, dispense: true }), /UNAVAILABLE/);
    });
  } finally {
    // Guard the destructive cleanup against ever targeting the configured app DB.
    try {
      if (mongoose.connection.name === dbName && dbName.startsWith('vita_prescription_test_')) await mongoose.connection.dropDatabase();
    } finally { await mongoose.disconnect(); }
  }
});
