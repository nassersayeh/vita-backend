const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(customers = [{ _id: 'customer' }]) {
  const seen = { finds: [], counts: [], quotes: [], people: [] };
  const models = {};
  const chain = (rows, entry) => ({
    select(fields) { entry.fields = fields; return this; },
    populate(fields) { entry.populate = fields; return this; },
    sort(sort) { entry.sort = sort; return this; },
    skip(value) { entry.skip = value; return this; },
    limit(value) { entry.limit = value; return this; }, lean: async () => rows,
  });
  for (const name of ['EPrescription', 'ControlledPrescription', 'PharmacyPrescriptionQuote', 'ControlledQuote', 'LabRequest', 'MedicalExamRequest', 'ImageRequest', 'Order']) {
    models[name] = {
      find(filter) { const entry = { name, filter }; seen.finds.push(entry); return chain([{ _id: 'record', status: 'pending' }], entry); },
      countDocuments: async filter => { seen.counts.push({ name, filter }); return 21; },
      distinct: async (field, filter) => { seen.quotes.push({ name, field, filter }); return ['quoted-prescription']; },
    };
  }
  models.User = { find(filter) { seen.people.push(filter); return chain(customers, {}); } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/adminSalesActivity'), 'utf8'), { module, require: path => models[path.split('/').pop()] });
  return { get: module.exports.getAdminSalesActivity, seen };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('activity scopes all rows and counts to selected manager customers and paginates', async () => {
  const { get, seen } = setup();
  const result = await get('manager', { type: 'prescriptions', execution: 'done', page: '2', salesManager: 'attacker' });
  assert.equal(result.total, 21); assert.equal(result.page, 2);
  assert.equal(seen.people[0].salesManager, 'manager');
  const query = seen.finds[0];
  assert.equal(query.skip, 20); assert.equal(query.limit, 20);
  assert.deepEqual(plain(query.filter), plain(seen.counts[0].filter));
  assert.deepEqual(plain(query.filter.$and[0].$or), [
    { doctorId: { $in: ['customer'] } }, { patientId: { $in: ['customer'] } },
    { dispensedBy: { $in: ['customer'] } }, { routedTo: { $in: ['customer'] } },
    { _id: { $in: ['quoted-prescription'] } },
  ]);
  assert.deepEqual(plain(seen.quotes[0].filter), { pharmacy: { $in: ['customer'] } });
  assert.equal(query.filter.$and[1].$or[0].dispensedAt.$type, 'date');
  assert.ok(query.fields.includes('routedAt'));
  assert.ok(!query.fields.includes('integritySeal'));
  for (const person of query.populate) assert.ok(!/password|token|otp/i.test(person.select));
  assert.deepEqual(plain(seen.finds[1].filter), { prescription: { $in: ['record'] } });
});

test('unexecuted keeps cancelled and rejected history and uses actual fulfillment, not payment', async () => {
  for (const type of ['diagnostics', 'exams', 'images', 'orders', 'controlled']) {
    const { get, seen } = setup();
    await get('manager', { type, execution: 'pending' });
    const query = seen.finds[0];
    const negative = query.filter.$and.find(clause => clause.$nor).$nor[0];
    if (type === 'controlled') {
      assert.equal(negative.$or[1].dispensedCount.$gt, 0);
      assert.ok(query.filter.$and.some(clause => clause.issuedAt));
      assert.ok(!query.fields.includes('integritySeal'));
    } else if (type === 'orders') assert.deepEqual(plain(negative.status.$in), ['delivered', 'completed', 'paid']);
    else assert.equal(negative.status, 'completed');
    assert.ok(!JSON.stringify(query.filter).includes('isPaid'));
    assert.ok(!JSON.stringify(query.filter).includes('cancelled'));
  }
});

test('empty customer scope cannot fall back to a global query; invalid filters are rejected', async () => {
  const { get, seen } = setup([]);
  assert.equal((await get('empty-manager')).total, 0);
  assert.equal(seen.finds.length, 0); assert.equal(seen.counts.length, 0);
  for (const query of [{ type: '__proto__' }, { type: 'invalid' }, { execution: 'invalid' }]) {
    await assert.rejects(get('manager', query), error => error.status === 400);
  }
});
