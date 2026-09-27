const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const fs = require('fs');
const vm = require('vm');
const { createRequire } = require('module');
const path = require('path');
const { randomUUID } = require('crypto');

test('controlled workflow on isolated temporary collections', { skip: process.env.RUN_CONTROLLED_INTEGRATION !== '1' }, async t => {
  require('dotenv').config({ quiet: true });
  const prefix = `codex_controlled_test_${randomUUID().replaceAll('-', '')}_`;
  const connection = await mongoose.createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const models = {};
  let server;
  try {
    const userSchema = new mongoose.Schema({ fullName: String, role: String, country: String, activationStatus: String, idNumber: String, mobileNumber: String, email: String, city: String, address: String, specialty: String });
    models.User = connection.model(`${prefix}User`, userSchema, `${prefix}users`);
    for (const name of ['ControlledPrescription', 'ControlledAllocation', 'ControlledAccess', 'ControlledDrug', 'Drug', 'PharmacyInventory', 'ControlledQuote', 'OversightAccount', 'ControlledSecurityEvent']) {
      const schema = require(`../models/${name}`).schema.clone();
      // Legacy catalog/account schemas declare duplicate indexes; keep path indexes in these test copies.
      if (['Drug', 'OversightAccount'].includes(name)) schema.clearIndexes();
      for (const field of ['patientId', 'doctorId', 'dispensedBy', 'pharmacyId', 'userId']) if (schema.path(field)) schema.path(field).options.ref = `${prefix}User`;
      models[name] = connection.model(`${prefix}${name}`, schema, `${prefix}${name.toLowerCase()}`);
    }
    await Promise.all(Object.values(models).map(model => model.init()));
    const users = await models.User.create([
      { fullName: 'Test Doctor', role: 'Doctor', country: 'Palestine', activationStatus: 'active', idNumber: 'TEST-DOC', mobileNumber: '000001' },
      { fullName: 'Test Pharmacy', role: 'Pharmacy', country: 'Palestine', activationStatus: 'active', idNumber: 'TEST-PHARM', mobileNumber: '000002' },
      { fullName: 'Test Patient', role: 'User', country: 'Palestine', activationStatus: 'active', idNumber: 'TEST-PATIENT', mobileNumber: '000003' },
      { fullName: 'Other Pharmacy', role: 'Pharmacy', country: 'Palestine', activationStatus: 'active', mobileNumber: '000004' },
    ]);
    const [doctor, pharmacy, patient, other] = users;
    const actors = Object.fromEntries(users.map(user => [String(user._id), { id: user._id, role: user.role, user }]));
    for (const role of ['medical_syndicate', 'pharmacy_syndicate', 'ministry_of_health']) actors[role] = { id: new mongoose.Types.ObjectId(), role, account: { type: role } };
    const filename = path.resolve(__dirname, '../routes/controlledPrescriptions.js');
    const nativeRequire = createRequire(filename);
    const logModule = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../middleware/controlledSecurityLog'), 'utf8'), { module: logModule, console,
      require: name => name === '../models/ControlledSecurityEvent' ? models.ControlledSecurityEvent : nativeRequire(name) });
    const moduleObject = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      require: name => name === '../middleware/controlledAuth' ? (req, res, next) => { req.controlledActor = actors[req.headers['x-test-actor']]; next(); } : name === '../middleware/controlledSecurityLog' ? logModule.exports : name.startsWith('../models/') ? models[name.split('/').pop()] : nativeRequire(name),
      module: moduleObject, exports: moduleObject.exports, console, Date, Set, Map, Buffer,
    }, { filename });
    const app = express(); app.use(express.json()); app.use(moduleObject.exports);
    server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    const request = async (actor, method, url, body) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { 'Content-Type': 'application/json', 'x-test-actor': String(actor) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() };
    };
    const drug = await models.Drug.create({ name: 'Test regulated medicine' });
    await models.PharmacyInventory.create({ pharmacyId: pharmacy._id, drugId: drug._id, drugName: drug.name, quantity: 100, price: 10 });
    const body = { patientId: patient._id, requestId: randomUUID(), products: [{ drugId: drug._id, quantity: 3, allowedPills: 30, dose: '1 pill', frequency: 'daily' }], validityType: 'time-limited', expiryDate: new Date(Date.now() + 3600000).toISOString() };
    let allocation;
    let issued;
    await t.test('only the medical syndicate may allocate; retry does not duplicate a batch', async () => {
      const payload = { doctorId: doctor._id, quantity: 2, paid: false, requestId: randomUUID() };
      assert.equal((await request('ministry_of_health', 'POST', '/allocations', payload)).status, 403);
      const res = await request('medical_syndicate', 'POST', '/allocations', payload);
      assert.equal(res.status, 200, JSON.stringify(res.data)); allocation = res.data.allocation;
      assert.equal((await request('medical_syndicate', 'POST', '/allocations', payload)).status, 200);
      assert.equal(await models.ControlledPrescription.countDocuments(), 2);
    });
    await t.test('unapproved doctor and unpaid balance cannot issue', async () => {
      assert.equal((await request(doctor._id, 'POST', '/prescriptions', body)).status, 403);
      assert.equal((await request('medical_syndicate', 'PATCH', `/providers/${doctor._id}/access`, { unionApproved: true })).status, 200);
      assert.equal((await request('ministry_of_health', 'PATCH', `/drugs/${drug._id}`, { approved: true })).status, 200);
      assert.equal((await request(doctor._id, 'POST', '/prescriptions', body)).status, 409);
    });
    await t.test('paid quota issues unique serials atomically under concurrent requests', async () => {
      assert.equal((await request('medical_syndicate', 'PATCH', `/allocations/${allocation._id}/payment`, { paid: true })).status, 200);
      const results = await Promise.all(Array.from({ length: 3 }, () => request(doctor._id, 'POST', '/prescriptions', { ...body, requestId: randomUUID() })));
      const successful = results.filter(r => r.status === 201);
      assert.equal(successful.length, 2, JSON.stringify(results));
      issued = successful.map(r => r.data.prescription);
      assert.notEqual(issued[0].serial, issued[1].serial);
      assert.equal((await request(doctor._id, 'POST', '/prescriptions', { ...body, requestId: issued[0].issueRequestId })).data.prescription._id, issued[0]._id);
      assert.equal(await models.ControlledPrescription.countDocuments(), 2);
    });
    await t.test('pharmacy selection and independent ministry suspension are enforced', async () => {
      assert.equal((await request(other._id, 'GET', `/prescriptions?idNumber=${patient.idNumber}`)).data.rows.length, 0);
      assert.equal((await request('pharmacy_syndicate', 'PATCH', `/providers/${pharmacy._id}/access`, { unionApproved: true })).status, 200);
      assert.equal((await request(pharmacy._id, 'GET', `/prescriptions?idNumber=${patient.idNumber}`)).data.rows.length, 2);
      assert.equal((await request('ministry_of_health', 'PATCH', `/providers/${pharmacy._id}/access`, { ministrySuspended: true })).status, 200);
      assert.equal((await request('pharmacy_syndicate', 'PATCH', `/providers/${pharmacy._id}/access`, { ministrySuspended: false })).status, 400);
      assert.equal((await request(pharmacy._id, 'GET', `/prescriptions?idNumber=${patient.idNumber}`)).data.rows.length, 0);
      assert.equal((await request('ministry_of_health', 'PATCH', `/providers/${pharmacy._id}/access`, { ministrySuspended: false })).status, 200);
    });
    await t.test('dispensing is single-use, retains audit and decrements stock exactly once', async () => {
      const rx = issued[0]; const prices = { items: rx.products.map(p => ({ prescriptionProductId: p._id, originalPrice: 10, discountedPrice: 8 })) };
      assert.equal((await request(other._id, 'PUT', `/prescriptions/${rx._id}/dispense`, prices)).status, 403);
      const response = await request(pharmacy._id, 'PUT', `/prescriptions/${rx._id}/dispense`, prices);
      assert.equal(response.status, 200, JSON.stringify(response.data));
      assert.equal((await request(pharmacy._id, 'PUT', `/prescriptions/${rx._id}/dispense`, prices)).status, 409);
      assert.equal((await models.PharmacyInventory.findOne({ pharmacyId: pharmacy._id })).quantity, 97);
      const trace = await request('ministry_of_health', 'GET', `/prescriptions/${rx._id}`);
      assert.equal(trace.status, 200, JSON.stringify(trace.data));
      assert.equal(trace.data.prescription.patientSnapshot.idNumber, patient.idNumber);
      assert.equal(trace.data.prescription.pharmacySnapshot.fullName, pharmacy.fullName);
      assert.equal(trace.data.prescription.audit.at(-1).action, 'dispensed');
      assert.equal(trace.data.prescription.pharmacyQuote, null);
      const unionTrace = await request('medical_syndicate', 'GET', `/prescriptions/${rx._id}`);
      assert.equal(unionTrace.data.prescription.pharmacyQuote.discountedTotal, 24);
    });
    await t.test('oversight trace visibility, finances, inventory and write restrictions', async () => {
      assert.equal((await request('pharmacy_syndicate', 'GET', `/prescriptions?serial=${issued[0].serial}`)).data.total, 1);
      assert.equal((await request('pharmacy_syndicate', 'GET', `/prescriptions?serial=${issued[1].serial}`)).data.total, 1);
      assert.equal((await request(other._id, 'GET', '/prescriptions?history=true')).data.total, 0);
      const financial = await request('medical_syndicate', 'GET', '/financials');
      assert.equal(financial.data.paid.amount, 4); assert.equal(financial.data.paid.syndicateShare, 2); assert.equal(financial.data.paid.vitaShare, 2);
      assert.equal((await request('ministry_of_health', 'GET', '/financials')).status, 403);
      const providers = await request('ministry_of_health', 'GET', '/providers?role=Doctor');
      assert.equal('allocations' in providers.data.rows[0], false);
      assert.equal('unpaidAmount' in providers.data.rows[0], false);
      assert.equal((await request('ministry_of_health', 'GET', '/inventory')).data.rows[0].quantity, 97);
      assert.equal((await request('ministry_of_health', 'POST', '/prescriptions', body)).status, 403);
      assert.equal((await request('medical_syndicate', 'PATCH', `/drugs/${drug._id}`, { approved: false })).status, 403);
      assert.equal((await request('ministry_of_health', 'PATCH', `/providers/${doctor._id}/access`, { ministrySuspended: true })).status, 200);
      assert.equal((await request(doctor._id, 'POST', '/prescriptions', body)).status, 403);
    });
    await t.test('approved drug totals and per-pharmacy drilldown exclude unapproved drugs and unrelated stock', async () => {
      const zeroDrug = await models.Drug.create({ name: 'Approved without stock' });
      const excluded = await models.Drug.create({ name: 'Not controlled' });
      await models.ControlledDrug.create([{ drugId: zeroDrug._id, approved: true }, { drugId: excluded._id, approved: false }]);
      await models.PharmacyInventory.create([
        { pharmacyId: other._id, drugId: drug._id, drugName: drug.name, quantity: 12, price: 20 },
        { pharmacyId: other._id, drugId: excluded._id, drugName: excluded.name, quantity: 700, price: 20 },
      ]);
      const foreign = await models.User.create({ fullName: 'Outside Palestine', role: 'Pharmacy', country: 'Jordan' });
      await models.PharmacyInventory.create({ pharmacyId: foreign._id, drugId: drug._id, drugName: drug.name, quantity: 999, price: 20 });
      const summary = await request('ministry_of_health', 'GET', '/inventory');
      assert.equal(summary.data.total, 2);
      assert.equal(summary.data.rows.find(r => r._id === String(drug._id)).quantity, 109);
      assert.equal(summary.data.rows.find(r => r._id === String(zeroDrug._id)).quantity, 0);
      const detail = await request('ministry_of_health', 'GET', `/inventory?drugId=${drug._id}`);
      assert.equal(detail.data.quantity, 109); assert.equal(detail.data.total, 2);
      assert.deepEqual(detail.data.rows.map(r => r.quantity), [97, 12]);
      assert.equal('price' in detail.data.rows[0], false);
      assert.equal((await request('ministry_of_health', 'GET', `/inventory?drugId=${excluded._id}`)).status, 404);
      assert.equal((await request('medical_syndicate', 'GET', `/inventory?drugId=${drug._id}`)).status, 403);
      const search = await request('ministry_of_health', 'GET', '/inventory?q=Approved');
      assert.equal(search.data.total, 1);
      await models.ControlledDrug.updateOne({ drugId: drug._id }, { $set: { approved: false } });
      assert.equal((await request('ministry_of_health', 'GET', `/inventory?drugId=${drug._id}`)).status, 404);
      assert.equal((await request('ministry_of_health', 'GET', '/inventory')).data.total, 1);
    });
    await t.test('provider permission and activity filters combine before pagination and include unassigned accounts', async () => {
      const docs = await models.User.create(Array.from({ length: 32 }, (_, i) => ({ fullName: `Filter Doctor ${String(i).padStart(2, '0')}`, role: 'Doctor', country: 'Palestine', activationStatus: 'active' })));
      await models.ControlledAccess.create([
        { userId: docs[30]._id, unionApproved: false, audit: [{ action: 'unionApproved:false' }] },
        { userId: docs[31]._id, unionApproved: true },
      ]);
      const list = async query => (await request('ministry_of_health', 'GET', `/providers?${query}`)).data;
      const blocked = await list('role=Doctor&permission=union_blocked');
      assert.equal(blocked.total, 1); assert.equal(blocked.rows[0]._id, String(docs[30]._id));
      const enabled = await list('role=Doctor&permission=enabled');
      assert.equal(enabled.total, 1); assert.equal(enabled.rows[0]._id, String(docs[31]._id));
      const pending = await list('role=Doctor&permission=unapproved&activity=none');
      assert.equal(pending.total, 30); assert.equal(pending.rows.length, 30);
      const suspendedActive = await list('role=Doctor&permission=ministry_blocked&activity=active');
      assert.equal(suspendedActive.total, 1); assert.equal(suspendedActive.rows[0].activityCount, 2);
      assert.equal((await list('role=Doctor&permission=not_allowed&activity=active')).total, 1);
      assert.equal((await list('role=Doctor&permission=enabled&activity=active')).total, 0);
      const dispensing = await list('role=Pharmacy&activity=active');
      assert.equal(dispensing.total, 1); assert.equal(dispensing.rows[0]._id, String(pharmacy._id)); assert.equal(dispensing.rows[0].activityCount, 1);
      const noDispensing = await list('role=Pharmacy&activity=none');
      assert.equal(noDispensing.total, 1); assert.equal(noDispensing.rows[0]._id, String(other._id));
      await models.User.updateOne({ _id: docs[31]._id }, { $set: { activationStatus: 'pending' } });
      assert.equal((await list('role=Doctor&permission=enabled')).total, 0);
      assert.equal((await list('role=Doctor&permission=inactive')).total, 1);
      assert.equal((await list('role=Doctor&q=Filter&activity=none')).total, 32);
      assert.equal((await list('role=Doctor&q=Filter&activity=none&page=2')).rows.length, 2);
      assert.equal((await request('ministry_of_health', 'GET', '/providers?permission=bad')).status, 400);
      assert.equal((await request('ministry_of_health', 'GET', '/providers?activity=bad')).status, 400);
    });
    await t.test('clinical tampering, cross-role access, field injection and replay cannot forge controlled prescriptions', async () => {
      await models.ControlledAccess.updateOne({ userId: doctor._id }, { $set: { unionApproved: true, ministrySuspended: false } });
      await models.ControlledDrug.updateOne({ drugId: drug._id }, { $set: { approved: true } });
      assert.equal((await request('medical_syndicate', 'POST', '/allocations', { doctorId: doctor._id, quantity: 3, paid: true, requestId: randomUUID() })).status, 200);
      for (const actor of [patient._id, pharmacy._id, 'medical_syndicate', 'pharmacy_syndicate', 'ministry_of_health']) {
        assert.equal((await request(actor, 'POST', '/prescriptions', { ...body, requestId: randomUUID() })).status, 403);
      }
      assert.equal((await request(patient._id, 'GET', '/prescriptions')).status, 403);
      assert.equal((await request(pharmacy._id, 'GET', `/prescriptions/${issued[1]._id}`)).status, 403);
      assert.equal((await request('medical_syndicate', 'PATCH', `/providers/${other._id}/access`, { unionApproved: true })).status, 403);
      assert.equal((await request(doctor._id, 'POST', '/prescriptions', { ...body, requestId: randomUUID(), patientId: { $ne: null } })).status, 400);
      for (const products of [[null], [{ ...body.products[0], quantity: true }], [{ ...body.products[0], dose: { $ne: null } }]]) {
        assert.equal((await request(doctor._id, 'POST', '/prescriptions', { ...body, requestId: randomUUID(), products })).status, 400);
      }
      const replayBody = { ...body, requestId: randomUUID(), serial: 'FORGED', doctorId: other._id, isValid: false, integritySeal: 'FORGED' };
      const replay = await Promise.all(Array.from({ length: 3 }, () => request(doctor._id, 'POST', '/prescriptions', replayBody)));
      assert.ok(replay.every(r => [200, 201].includes(r.status)), JSON.stringify(replay));
      assert.equal(new Set(replay.map(r => r.data.prescription._id)).size, 1);
      const rx = replay[0].data.prescription;
      assert.notEqual(rx.serial, 'FORGED'); assert.equal(String(rx.doctorId), String(doctor._id));
      assert.equal(rx.integritySeal, undefined);
      const trace = await request('ministry_of_health', 'GET', `/prescriptions/${rx._id}`);
      assert.equal(trace.data.prescription.integrityValid, true);
      assert.equal(trace.data.prescription.integritySeal, undefined);
      const stockBefore = await models.PharmacyInventory.findOne({ pharmacyId: pharmacy._id }).lean();
      await models.ControlledPrescription.updateOne({ _id: rx._id }, { $set: { 'products.0.quantity': 99 } });
      const changed = await request('ministry_of_health', 'GET', `/prescriptions/${rx._id}`);
      assert.equal(changed.data.prescription.integrityValid, false);
      const prices = { items: rx.products.map(p => ({ prescriptionProductId: p._id, originalPrice: 10, discountedPrice: 8 })) };
      assert.equal((await request(pharmacy._id, 'PUT', `/prescriptions/${rx._id}/dispense`, prices)).status, 409);
      const stockAfter = await models.PharmacyInventory.findById(stockBefore._id).lean();
      assert.equal(stockAfter.quantity, stockBefore.quantity);
      assert.equal(await models.ControlledQuote.countDocuments({ prescription: rx._id }), 0);
      assert.ok(await models.ControlledSecurityEvent.countDocuments({ actor: actors.ministry_of_health.id, status: 200 }) > 0);
    });
    await t.test('authority password changes verify the current secret and invalidate every prior session', async () => {
      const bcrypt = require('bcryptjs');
      const actor = actors.medical_syndicate;
      const currentPassword = 'Synthetic-password-123';
      const newPassword = 'Synthetic-replacement-456';
      await models.OversightAccount.create({ _id: actor.id, type: 'medical_syndicate', name: 'Synthetic Authority', nameAr: 'Test', email: 'test@example.invalid', username: 'test-authority', password: await bcrypt.hash(currentPassword, 4) });
      assert.equal((await request(doctor._id, 'POST', '/account/password', { currentPassword, newPassword })).status, 403);
      assert.equal((await request('medical_syndicate', 'POST', '/account/password', { currentPassword: 'incorrect', newPassword })).status, 403);
      assert.equal((await request('medical_syndicate', 'POST', '/account/password', { currentPassword, newPassword: 'short' })).status, 400);
      assert.equal((await request('medical_syndicate', 'POST', '/account/password', { currentPassword, newPassword })).status, 200);
      const account = await models.OversightAccount.findById(actor.id);
      assert.equal(await bcrypt.compare(newPassword, account.password), true);
      assert.equal(account.sessionVersion, 1); assert.ok(account.passwordChangedAt);
      assert.equal((await request('medical_syndicate', 'POST', '/account/password', { currentPassword, newPassword })).status, 403);
      assert.equal((await request('medical_syndicate', 'POST', '/account/logout', {})).status, 200);
      assert.equal((await models.OversightAccount.findById(actor.id)).sessionVersion, 2);
      assert.equal((await request('ministry_of_health', 'GET', '/prescriptions?doctorId[$ne]=null')).status, 400);
    });
    await t.test('authorities can stop only unfilled prescriptions and cancellation wins against in-flight dispensing', async () => {
      // Restore approvals revoked by the preceding filter/catalogue tests.
      await models.User.updateOne({ _id: doctor._id }, { $set: { activationStatus: 'active' } });
      await models.ControlledAccess.updateOne({ userId: doctor._id }, { $set: { unionApproved: true, ministrySuspended: false } });
      await models.ControlledDrug.updateOne({ drugId: drug._id }, { $set: { approved: true } });
      const allocationResponse = await request('medical_syndicate', 'POST', '/allocations', { doctorId: doctor._id, quantity: 4, paid: true, requestId: randomUUID() });
      assert.equal(allocationResponse.status, 200);
      const create = async () => (await request(doctor._id, 'POST', '/prescriptions', { ...body, requestId: randomUUID() })).data.prescription;
      for (const authority of ['medical_syndicate', 'pharmacy_syndicate', 'ministry_of_health']) {
        const rx = await create();
        const endpoint = `/prescriptions/${rx._id}/stop`;
        assert.equal((await request(doctor._id, 'PATCH', endpoint, { reason: 'Stop' })).status, 403);
        assert.equal((await request(pharmacy._id, 'PATCH', endpoint, { reason: 'Stop' })).status, 403);
        assert.equal((await request(authority, 'PATCH', endpoint, { reason: ' ' })).status, 400);
        const result = await request(authority, 'PATCH', endpoint, { reason: 'Test regulatory hold' });
        assert.equal(result.status, 200); assert.equal(result.data.prescription.isValid, false);
        assert.equal(result.data.prescription.stoppedByRole, authority);
        assert.equal(result.data.prescription.audit.at(-1).action, 'stopped');
        assert.equal((await request(authority, 'PATCH', endpoint, { reason: 'Second hold' })).status, 409);
        assert.equal((await request(pharmacy._id, 'PUT', `/prescriptions/${rx._id}/dispense`, { items: [] })).status, 409);
        const search = await request(pharmacy._id, 'GET', `/prescriptions?idNumber=${patient.idNumber}`);
        assert.equal(search.data.rows.some(row => row._id === rx._id), false);
        assert.equal((await request('pharmacy_syndicate', 'GET', `/prescriptions/${rx._id}`)).status, 200);
      }
      assert.equal((await request('ministry_of_health', 'PATCH', `/prescriptions/${issued[0]._id}/stop`, { reason: 'Already dispensed' })).status, 409);
      const rx = await create();
      const before = await models.PharmacyInventory.findOne({ pharmacyId: pharmacy._id, drugId: drug._id });
      const { saveStandalonePrescription } = require('../utils/saveStandalonePrescription');
      await assert.rejects(saveStandalonePrescription({
        Prescription: models.ControlledPrescription, Inventory: models.PharmacyInventory, Quote: models.ControlledQuote,
        prescriptionId: rx._id, pharmacyId: pharmacy._id, dispense: true,
        items: rx.products.map(p => ({ prescriptionProductId: p._id, originalPrice: 10, discountedPrice: 8 })),
        beforeCommit: async () => { assert.equal((await request('ministry_of_health', 'PATCH', `/prescriptions/${rx._id}/stop`, { reason: 'Stopped during dispense' })).status, 200); },
      }), /UNAVAILABLE/);
      const after = await models.PharmacyInventory.findById(before._id);
      assert.equal(after.quantity, before.quantity); assert.equal(after.soldCount, before.soldCount);
      const stopped = await models.ControlledPrescription.findById(rx._id).select('+pharmacyWriteLock');
      assert.ok(stopped.stoppedAt); assert.ok(!stopped.dispensedAt); assert.ok(!stopped.pharmacyWriteLock);
      assert.equal(await models.ControlledQuote.countDocuments({ prescription: rx._id }), 0);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const model of Object.values(models)) {
      if (model.collection.name.startsWith(prefix)) {
        try { await model.collection.drop(); } catch (error) { if (error.code !== 26) console.error('Temporary collection cleanup failed', model.collection.name, error.code); }
      }
    }
    await connection.close();
  }
});
