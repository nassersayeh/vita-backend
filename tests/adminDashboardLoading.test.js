const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function load(models) {
  const file = require.resolve('../controllers/adminController');
  const native = createRequire(file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, exports: module.exports, console, process, Buffer,
    require(name) {
      if (name.startsWith('../models/')) return models[name.slice('../models/'.length)] || {};
      if (name === '../utils/assignDefaultInventory') return {};
      return native(name);
    }
  });
  return module.exports;
}

test('analytics starts all independent queries together and preserves summary values', async () => {
  const releases = [];
  const query = value => { const promise = new Promise(resolve => releases.push(() => resolve(value))); return promise; };
  const controller = load({
    User: {
      schema: { path: () => ({ enumValues: ['User', 'Doctor'] }) },
      aggregate: pipeline => query(pipeline[0].$group ? [{ _id: 'User', count: 10, active: 7, pending: 3, recent: 2 }] : [{ totalRevenue: 50 }])
    },
    Appointment: { countDocuments: filter => query(filter ? 2 : 8) },
    Order: { countDocuments: filter => query(filter ? 3 : 15), aggregate: () => query([{ totalRevenue: 100 }]) },
    Points: { aggregate: () => query([{ total: 30 }]) },
    Financial: { aggregate: () => query([{ totalEarnings: 80, totalExpenses: 20 }]) }
  });
  let result;
  const pending = controller.getDashboardAnalytics({ query: {} }, { json(value) { result = value; }, status() { throw new Error('Unexpected failure'); } });
  assert.equal(releases.length, 9, 'all nine queries start before the first result resolves');
  releases.forEach(release => release());
  await pending;
  assert.equal(result.users.total, 10);
  assert.equal(result.users.byRole.Doctor, 0);
  assert.equal(result.appointments.total, 8);
  assert.equal(result.appointments.recent, 2);
  assert.equal(result.orders.total, 15);
  assert.equal(result.orders.recent, 3);
  assert.equal(result.orders.revenue, 150);
  assert.equal(result.points.totalAwarded, 30);
  assert.equal(result.financial.totalExpenses, 20);
});

test('invalid periods fail before accessing the database', async () => {
  const controller = load({});
  let status;
  await controller.getDashboardAnalytics({ query: { period: 'invalid' } }, {
    status(value) { status = value; return this; }, json() {}
  });
  assert.equal(status, 400);
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
