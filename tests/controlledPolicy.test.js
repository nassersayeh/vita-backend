const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { canPractice, serialFor, validateControlledProducts } = require('../utils/controlledPolicy');
const Rx = require('../models/ControlledPrescription');
const Allocation = require('../models/ControlledAllocation');
const Access = require('../models/ControlledAccess');
test('only active Palestinian providers with union approval and no ministry suspension may act', () => {
  const doctor = { role: 'Doctor', country: 'Palestine', activationStatus: 'active' };
  const access = { unionApproved: true, ministrySuspended: false };
  assert.equal(canPractice(doctor, access, 'Doctor'), true);
  for (const [user, permission] of [[{ ...doctor, country: 'Jordan' }, access], [{ ...doctor, activationStatus: 'pending' }, access], [doctor, null], [doctor, { ...access, unionApproved: false }], [doctor, { ...access, ministrySuspended: true }], [{ ...doctor, role: 'ministry_of_health' }, access]]) assert.equal(canPractice(user, permission, 'Doctor'), false);
  assert.equal(canPractice(doctor, access, 'Pharmacy'), false);
});
test('serials are deterministic per ticket and distinct across allocations and slots', () => {
  const a = new mongoose.Types.ObjectId(); const b = new mongoose.Types.ObjectId();
  const serials = [a, b].flatMap(id => Array.from({ length: 1000 }, (_, i) => serialFor(id, i)));
  assert.equal(new Set(serials).size, 2000);
  assert.equal(serialFor(a, 0), serialFor(a, 0));
  assert.match(serials[0], /^PS-CR-[A-F\d]{24}-0001$/);
});
test('controlled medicines require whole positive quantities, allowed pill count, dose and frequency', () => {
  const product = { drugId: new mongoose.Types.ObjectId().toString(), quantity: 2, allowedPills: 30, dose: '1 pill', frequency: 'daily' };
  validateControlledProducts([product]);
  for (const products of [[], [product, product], [{ ...product, drugId: 'bad' }], [{ ...product, quantity: 1.5 }], [{ ...product, allowedPills: 0 }], [{ ...product, allowedPills: '' }], [{ ...product, dose: '' }], [{ ...product, frequency: '' }]]) assert.throws(() => validateControlledProducts(products));
});
test('serial and request indexes protect uniqueness; quotas and permissions have separate records', async () => {
  assert.ok(Rx.schema.indexes().some(([fields, options]) => fields.serial === 1 && options.unique));
  assert.ok(Rx.schema.indexes().some(([fields, options]) => fields.issueRequestId === 1 && options.unique));
  assert.equal(Rx.schema.path('serial').options.immutable, true);
  const allocation = new Allocation({ doctorId: new mongoose.Types.ObjectId(), createdBy: new mongoose.Types.ObjectId(), quantity: 5, requestId: 'unique-request-1234' });
  await allocation.validate();
  assert.equal(allocation.paid, false);
  assert.equal(allocation.unitPrice, 2);
  assert.equal(allocation.syndicateShare, 1);
  assert.equal(allocation.vitaShare, 1);
  const access = new Access({ userId: new mongoose.Types.ObjectId() });
  assert.equal(access.unionApproved, false); assert.equal(access.ministrySuspended, false);
  assert.equal(require('../models/User').schema.path('unionApproved'), undefined);
});
