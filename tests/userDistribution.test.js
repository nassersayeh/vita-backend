const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeUserDistribution, userDistributionPipeline } = require('../utils/userDistribution');

test('includes missing roles and legacy roles without dropping accounts', () => {
  const result = summarizeUserDistribution([
    { _id: 'User', count: 12, active: 8, pending: 2, recent: 3 },
    { _id: 'Clinic', count: 2, active: 1, pending: 1, recent: 1 },
    { _id: 'LegacyRole', count: 1, active: 0, pending: 0, recent: 0 },
    { _id: 'Unknown', count: 1, active: 0, pending: 0, recent: 0 }
  ], ['User', 'Clinic', 'Institution', 'Radiology']);
  assert.equal(result.total, 16);
  assert.equal(result.active, 9);
  assert.equal(result.pending, 3);
  assert.equal(result.byRole.Institution, 0);
  assert.equal(result.byRole.Clinic, 2);
  assert.equal(result.byRole.Radiology, 0);
  assert.equal(result.byRole.LegacyRole, 1);
  assert.equal(result.byRole.Unknown, 1);
  assert.equal(result.recentRegistrations.Clinic, 1);
  assert.equal(Object.values(result.byRole).reduce((a, b) => a + b, 0), result.total);
});

test('empty database reports zeros for every supported role', () => {
  assert.deepEqual(summarizeUserDistribution([], ['Doctor']), {
    total: 0, active: 0, pending: 0, byRole: { Doctor: 0 }, recentRegistrations: { Doctor: 0 }
  });
});

test('live aggregation agrees with independent counts and registration boundaries', { skip: !process.env.VERIFY_LIVE_DISTRIBUTION }, async () => {
  require('dotenv').config();
  const mongoose = require('mongoose');
  const User = require('../models/User');
  const connection = await mongoose.createConnection(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 10000 }).asPromise();
  try {
    const users = connection.collection('users');
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86400000);
    const result = summarizeUserDistribution(await users.aggregate(userDistributionPipeline(start, end)).toArray(), User.schema.path('role').enumValues);
    assert.equal(result.total, await users.countDocuments());
    assert.equal(result.active, await users.countDocuments({ activationStatus: 'active' }));
    assert.equal(result.pending, await users.countDocuments({ activationStatus: 'pending' }));
    for (const [role, count] of Object.entries(result.byRole)) {
      assert.equal(count, await users.countDocuments({ role }), role);
      assert.equal(result.recentRegistrations[role], await users.countDocuments({ role, createdAt: { $gte: start, $lte: end } }), `${role} recent`);
    }
    console.log(`Verified ${result.total} accounts across ${Object.keys(result.byRole).length} roles`);
  } finally {
    await connection.close();
  }
});
