const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { orderablePrescriptionFilter, annotatePatientPrescription } = require('../utils/patientPrescriptionEligibility');

test('purchase filter excludes used, dispensed and expired single-use prescriptions before pagination', () => {
  const now = new Date('2026-10-24T10:00:00Z');
  const filter = orderablePrescriptionFilter(['used-id'], now);
  assert.equal(filter.isValid, true);
  assert.deepEqual(filter.$and[0].$or, [{ expiryDate: null }, { expiryDate: { $gte: now } }]);
  const [repeatable, singleUse] = filter.$and[1].$or;
  assert.deepEqual(repeatable, { validityType: { $ne: 'one-time' } });
  assert.deepEqual(singleUse._id.$nin, ['used-id']);
  assert.equal(singleUse.dispensedAt, null);
  assert.deepEqual(singleUse.dispensedCount.$in, [0, null]);
});

test('medical history marks used one-time prescriptions without disabling repeatable prescriptions', () => {
  const usedIds = new Set(['used']);
  assert.equal(annotatePatientPrescription({ _id: 'used', validityType: 'one-time' }, usedIds).alreadyOrdered, true);
  assert.equal(annotatePatientPrescription({ _id: 'used', validityType: 'time-limited' }, usedIds).alreadyOrdered, false);
  assert.equal(annotatePatientPrescription({ _id: 'unused', validityType: 'one-time' }, usedIds).alreadyOrdered, false);
});

function setup() {
  const seen = {};
  const filename = require.resolve('../routes/prescriptionsEnhanced');
  const native = createRequire(filename);
  const page = [{ _id: 'used', validityType: 'one-time', isValid: true }];
  const query = result => ({
    populate() { return this; }, sort() { return this; }, limit() { return this; }, skip() { return this; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  });
  const models = {
    '../models/EPrescription': {
      find(filter) { seen.filter = filter; return query(page); },
      countDocuments: async filter => { seen.countFilter = filter; return 1; },
      findOne(filter) { seen.selectedFilter = filter; return query({ _id: filter._id, validityType: 'one-time', isValid: true }); },
    },
    '../models/Order': { distinct: async (field, filter) => { seen.orders = { field, filter }; return ['used']; } },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console: { log() {}, error() {} },
    require: name => name in models ? models[name]
      : name.startsWith('../middleware/') ? (req, res, next) => next()
      : name.startsWith('../models/') ? {} : native(name),
  });
  const request = params => new Promise((resolve, reject) => {
    module.exports.handle({ method: 'GET', url: '/patient-id', headers: {}, query: params, user: { _id: 'patient-id', role: 'User' } }, {
      status() { return this; }, json: resolve,
    }, reject);
  });
  return { request, seen };
}

test('patient purchase route applies one eligibility filter to list/count and checks older routed prescriptions', async () => {
  const { request, seen } = setup();
  const id = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const result = await request({ orderable: 'true', selectedPrescriptionId: id });
  assert.equal(seen.orders.field, 'prescriptionId');
  assert.equal(seen.orders.filter.user, 'patient-id');
  assert.equal(seen.filter.patientId, 'patient-id');
  assert.equal(seen.filter.isValid, true);
  assert.equal(seen.filter, seen.countFilter);
  assert.deepEqual(seen.filter.$and[1].$or[1]._id.$nin, ['used']);
  assert.equal(seen.selectedFilter._id, id);
  assert.equal(seen.selectedFilter.isValid, true);
  assert.equal(result.selectedPrescription._id, id);
});

test('history route keeps previous prescriptions and exposes their ordered status', async () => {
  const { request, seen } = setup();
  const result = await request({});
  assert.equal(seen.filter.$and, undefined);
  assert.equal(result.prescriptions[0].alreadyOrdered, true);
});
