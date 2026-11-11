const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function load(models, services = {}) {
  const file = require.resolve('../controllers/adminController');
  const native = createRequire(file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, exports: module.exports, console, process, Buffer,
    require(name) {
      if (name.startsWith('../models/')) return models[name.slice('../models/'.length)] || {};
      if (name === '../utils/assignDefaultInventory') return {};
      if (name === '../services/salesMetrics') return services;
      return native(name);
    }
  });
  return module.exports;
}

test('monthly medicine revenue is realized commission, with complete Riyadh month boundaries', async () => {
  let pipeline, result;
  const controller = load({ Order: { aggregate: async value => { pipeline = value; return [{ totalRevenue: 0.6, grossOrderValue: 30 }]; } } });
  await controller.getRevenueByMonth({ params: { year: '2026', month: '11' } }, { json(value) { result = value; }, status() { throw Error('Unexpected failure'); } });
  assert.equal(result.orderRevenue, 0.6); assert.equal(result.grossOrderValue, 30);
  assert.equal(pipeline[2].$match.commissionRealizedAt.$gte.toISOString(), '2026-10-31T21:00:00.000Z');
  assert.equal(pipeline[2].$match.commissionRealizedAt.$lt.toISOString(), '2026-11-30T21:00:00.000Z');
  assert.equal(pipeline[1].$addFields.commissionRealizedAt.$ifNull[0], '$deliveredAt');
});

test('analytics starts all independent queries together and preserves summary values', async () => {
  const releases = [];
  const query = value => { const promise = new Promise(resolve => releases.push(() => resolve(value))); return promise; };
  const controller = load({
    User: {
      schema: { path: () => ({ enumValues: ['User', 'Doctor'] }) },
      find: () => ({ select() { return this; }, sort() { return this; }, limit(value) { assert.equal(value, 5); return this; }, lean() { return query([{ fullName: 'Latest account', role: 'User' }]); } }),
      aggregate: pipeline => query(pipeline[0].$group ? [{ _id: 'User', count: 10, active: 7, pending: 3, recent: 2 }] : [{ totalRevenue: 50 }])
    },
    Appointment: { countDocuments: filter => query(filter ? 2 : 8) },
    Order: { countDocuments: filter => query(filter ? 3 : 15), aggregate: pipeline => {
      assert.equal(pipeline[3].$group.totalRevenue.$sum, '$vitaCommissionAmount');
      assert.equal(pipeline[3].$group.grossOrderValue.$sum, '$total');
      assert.equal(JSON.stringify(pipeline[0].$match.status), JSON.stringify({ $in: ['delivered', 'completed'] }));
      return query([{ totalRevenue: 0.6, grossOrderValue: 30 }]);
    } },
    Points: { aggregate: () => query([{ total: 30 }]) },
    Financial: { aggregate: () => query([{ totalEarnings: 80, totalExpenses: 20 }]) }
  }, { platformCommissions: () => query({ vitaCommission: 48.62, medicineCommission: 3.42, diagnosticCommission: 45.2, treatmentCommission: 0, currency: 'ILS', period: 'all_time' }) });
  let result;
  const pending = controller.getDashboardAnalytics({ query: {} }, { json(value) { result = value; }, status() { throw new Error('Unexpected failure'); } });
  assert.equal(releases.length, 11, 'all summary queries start before the first result resolves');
  releases.forEach(release => release());
  await pending;
  assert.equal(result.users.total, 10);
  assert.equal(result.users.byRole.Doctor, 0);
  assert.equal(result.appointments.total, 8);
  assert.equal(result.appointments.recent, 2);
  assert.equal(result.orders.total, 15);
  assert.equal(result.orders.recent, 3);
  assert.equal(result.orders.revenue, 50.6);
  assert.equal(result.orders.orderRevenue, 0.6);
  assert.equal(result.orders.grossOrderValue, 30);
  assert.equal(result.commissions.vitaCommission, 48.62);
  assert.equal(result.commissions.currency, 'ILS');
  assert.equal(result.commissions.period, 'all_time');
  assert.equal(result.points.totalAwarded, 30);
  assert.equal(result.financial.totalExpenses, 20);
  assert.equal(result.latestUsers[0].fullName, 'Latest account');
});

test('invalid periods fail before accessing the database', async () => {
  const controller = load({});
  let status;
  await controller.getDashboardAnalytics({ query: { period: 'invalid' } }, {
    status(value) { status = value; return this; }, json() {}
  });
  assert.equal(status, 400);
});

test('pending registrations and plan changes are read together with their displayed fields', async () => {
  const releases = [];
  const selections = [];
  const controller = load({ User: { find(filter) {
    return { select(value) { selections.push(value); return this; }, sort() { return this; }, lean() {
      return new Promise(resolve => releases.push(() => resolve([{ _id: filter.activationStatus, activationStatus: filter.activationStatus, planChangeRequest: { requestedAt: '2026-10-20' } }])));
    } };
  } } });
  let result;
  const response = controller.getPendingApprovals({}, { json(value) { result = value; }, status() { throw Error('Unexpected failure'); } });
  assert.equal(releases.length, 2);
  releases.forEach(release => release());
  await response;
  assert.equal(result.length, 2);
  assert.equal(result[0].approvalRequestType, 'plan_change');
  assert.equal(result[1].approvalRequestType, 'registration');
  assert.ok(selections.every(value => value.includes('mobileNumber') && value.includes('planChangeRequest') && !value.includes('patients')));
});

test('directory uses account summary fields and keeps full account requests compatible', async () => {
  const selections = [], leanOptions = [];
  const rows = [{ _id: 'doctor', role: 'Doctor', fullName: 'Doctor' }];
  const query = {
    select(value) { selections.push(value); return this; },
    populate() { return this; }, sort() { return this; },
    lean(value) { leanOptions.push(value); return Promise.resolve(rows); }
  };
  const controller = load({ User: { find: () => query } });
  for (const view of ['directory', undefined]) {
    let result;
    await controller.getAllUsers({ query: { limit: 'all', view } }, {
      json(value) { result = value; }, status() { throw new Error('Unexpected failure'); }
    });
    assert.equal(result.users, rows);
    assert.equal(result.total, 1);
  }
  assert.match(selections[0], /fullName/);
  assert.match(selections[0], /registeredBy/);
  assert.doesNotMatch(selections[0], /password|patients|medicalHistory/);
  assert.equal(selections[1], '-password');
  assert.deepEqual(leanOptions, [true, false]);
});

test('directory paginates and applies filters across the database while returning city metadata', async () => {
  let filter, offset, limit;
  const rows = [{ _id: 'user', fullName: 'Patient', role: 'User' }];
  const query = {
    select() { return this; }, populate() { return this; }, sort() { return this; },
    limit(value) { limit = value; return this; },
    skip(value) { offset = value; return this; }, lean() { return Promise.resolve(rows); }
  };
  const controller = load({ User: {
    find(value) { filter = value; return query; },
    countDocuments(value) { assert.equal(value, filter); return Promise.resolve(153); },
    distinct(field) { assert.equal(field, 'city'); return Promise.resolve(['Nablus', '', ' Nablus ', 'Ramallah']); }
  } });
  let result;
  await controller.getAllUsers({ query: { view: 'directory', limit: 50, page: 2, search: 'Patient[', role: 'User', city: 'Nablus', includeCities: 'true' } }, {
    json(value) { result = value; }, status() { throw new Error('Unexpected failure'); }
  });
  assert.equal(limit, 50);
  assert.equal(offset, 50);
  assert.equal(filter.role, 'User');
  assert.equal(filter.city, 'Nablus');
  assert.equal(filter.$or[0].fullName.$regex, 'Patient\\[');
  assert.equal(result.totalPages, 4);
  assert.equal(result.total, 153);
  assert.equal(result.currentPage, 2);
  assert.deepEqual(Array.from(result.cities), ['Nablus', 'Ramallah']);
});
