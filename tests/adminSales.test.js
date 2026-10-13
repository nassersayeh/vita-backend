const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const filename = require.resolve('../routes/adminSales');
const native = createRequire(filename);
function load(User, customerMetrics = async rows => rows) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, console, require: name => name === '../models/User' ? User : name === '../services/salesMetrics' ? { customerMetrics, teamCommissions: async () => new Map() } : native(name) });
  return module.exports;
}
function request(router, url, role = 'Admin', query = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No response')), 2000);
    const res = { statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { clearTimeout(timer); resolve({ status: this.statusCode, body }); } };
    router.handle({ method: 'GET', url, originalUrl: url, headers: {}, user: { role }, query }, res, error => { clearTimeout(timer); reject(error || new Error('Unhandled route')); });
  });
}
const chain = rows => ({ select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => rows });
test('admin sales denies sales staff, ordinary accounts and missing identity', async () => {
  const router = load({ find() { throw new Error('Must not access DB'); } });
  for (const role of ['SalesManager', 'Doctor', 'Pharmacy', undefined]) {
    for (const url of ['/', '/aaaaaaaaaaaaaaaaaaaaaaaa/customers']) assert.equal((await request(router, url, role || 'unknown')).status, 403);
  }
});
test('summary includes every customer across batches and staff with zero customers', async () => {
  let batch = 0;
  const router = load({ find(filter) {
    if (filter.role === 'SalesManager') return chain([{ _id: 'A', fullName: 'A' }, { _id: 'B', fullName: 'B' }]);
    assert.equal(filter.salesManager.$in.join(','), 'A,B');
    if (batch++) { assert.equal(filter._id.$gt, 250); return chain([{ _id: 251, salesManager: 'A', role: 'Doctor' }]); }
    return chain(Array.from({ length: 250 }, (_, i) => ({ _id: i + 1, salesManager: 'A', role: 'Doctor' })));
  } }, async rows => rows.map(row => ({ ...row, prescriptionCount: 2, radiologyCount: 3, appointmentCount: 4 })));
  const result = await request(router, '/');
  assert.equal(result.status, 200);
  assert.equal(result.body.managers[0].customerCount, 251);
  assert.equal(result.body.managers[0].prescriptionCount, 502);
  assert.equal(result.body.managers[0].radiologyCount, 753);
  assert.equal(result.body.managers[0].appointmentCount, 1004);
  assert.equal(result.body.managers[1].customerCount, 0);
});
test('detail validates manager and scopes pagination to selected staff', async () => {
  const id = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const router = load({
    findOne(filter) { assert.equal(filter.role, 'SalesManager'); return chain({ _id: id, fullName: 'A' }); },
    find(filter) {
      assert.equal(filter.salesManager, id);
      const q = chain([{ fullName: 'Customer' }]);
      q.skip = value => { assert.equal(value, 25); return q; };
      q.limit = value => { assert.equal(value, 25); return q; };
      return q;
    },
    countDocuments: async filter => { assert.equal(filter.salesManager, id); return 30; },
  });
  assert.equal((await request(router, '/bad/customers')).status, 400);
  const result = await request(router, `/${id}/customers`, 'Superadmin', { page: '2', salesManager: 'attacker' });
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 30);
  assert.equal(result.body.page, 2);
  const missing = load({ findOne: () => chain(null) });
  assert.equal((await request(missing, `/${id}/customers`)).status, 404);
});

test('team lead can read team reports', async () => {
  const router = load({ find: () => chain([]) });
  const response = await request(router, '/', 'SalesTeamLead');
  assert.equal(response.status, 200);
  assert.equal(response.body.managers.length, 0);
});
