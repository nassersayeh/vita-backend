const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function fixture({ failInsert = false, duplicate = false, sourceMissing = false } = {}) {
  const seen = { cleanup: [] };
  const chain = rows => ({ select(value) { seen.selection = value; return this; }, sort() { return this; }, lean: async () => rows });
  const services = [{ _id: 'old-service', name: 'CBC', price: 35, category: 'Routine', unit: 'g', fields: [{ label: 'Hb', type: 'number' }] }];
  const Model = { find(filter) { seen.serviceFilter = filter; return chain(services); }, async insertMany(docs) { seen.docs = docs; if (failInsert) throw Error('failed'); }, async deleteMany(filter) { seen.cleanup.push(filter); } };
  const User = { find: () => chain([{ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', fullName: 'Source' }]), exists: async filter => filter.mobileNumber ? duplicate : !sourceMissing,
    async create(fields) { seen.user = fields; return fields; }, async deleteOne(filter) { seen.cleanup.push(filter); } };
  const filename = require.resolve('../routes/salesProviders'), native = createRequire(filename), module = { exports: {} };
  const mocks = { '../models/User': User, '../models/MedicalTest': Model, '../models/LaboratoryService': Model, bcryptjs: { hash: async () => 'hashed-password' }, '../middleware/authRateLimiter': { salesSignupLimiter: (req, res, next) => next() } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console, require: name => name in mocks ? mocks[name] : native(name) });
  const payload = { role: 'Lab', fullName: 'New provider', mobile: '0591111111', password: 'strong-pass-987', city: 'Nablus', address: 'Main street', sourceId: 'aaaaaaaaaaaaaaaaaaaaaaaa' };
  const request = (method = 'POST', body = payload, query = {}) => new Promise((resolve, reject) => {
    module.exports.handle({ method, url: method === 'GET' ? '/templates' : '/', headers: {}, user: { _id: 'verified-sales', role: 'SalesManager' }, body, query }, { code: 200, status(n) { this.code = n; return this; }, json(body) { resolve({ code: this.code, body }); } }, reject);
  });
  return { seen, request, payload, services };
}
test('lab and radiology templates are scoped to their correct source owner and model fields', async () => {
  for (const role of ['Lab', 'Radiology']) {
    const f = fixture();
    const res = await f.request('GET', {}, { role });
    assert.equal(res.code, 200);
    assert.equal(res.body.templates[0].services.length, 1);
    assert.equal(f.seen.serviceFilter[role === 'Lab' ? 'laboratoryId' : 'providerId'], 'aaaaaaaaaaaaaaaaaaaaaaaa');
    if (role === 'Radiology') assert.equal(f.seen.serviceFilter.type, 'radiology');
  }
});
test('new provider activates immediately with independent services and authenticated attribution, without customer token', async () => {
  for (const role of ['Lab', 'Radiology']) {
    const f = fixture();
    const res = await f.request('POST', { ...f.payload, role, activationStatus: 'pending', salesManager: 'attacker', clinicId: 'attacker', isPublic: false });
    assert.equal(res.code, 201);
    assert.equal(f.seen.user.role, role);
    assert.equal(f.seen.user.activationStatus, 'active');
    assert.equal(f.seen.user.salesManager, 'verified-sales');
    assert.equal(f.seen.user.approvedBy, 'verified-sales');
    assert.equal(f.seen.user.registeredBy, 'verified-sales');
    assert.equal(f.seen.user.isPhoneVerified, true);
    assert.equal(f.seen.user.isPublic, true);
    assert.equal(f.seen.user.clinicId, undefined);
    assert.equal(f.seen.user.password, 'hashed-password');
    assert.equal(f.seen.docs[0][role === 'Lab' ? 'laboratoryId' : 'providerId'], f.seen.user._id);
    assert.equal(f.seen.docs[0]._id, undefined);
    assert.equal(f.seen.docs[0].price, 35);
    assert.equal(f.seen.docs[0].name, 'CBC');
    if (role === 'Lab') assert.equal(f.seen.docs[0].fields[0].label, 'Hb');
    if (role === 'Radiology') assert.equal(f.seen.docs[0].type, 'radiology');
    assert.equal(res.body.token, undefined);
    assert.equal(res.body.user.password, undefined);
    assert.equal(res.body.serviceCount, 1);
  }
});
test('invalid input and privileged roles are rejected without writes', async () => {
  for (const overrides of [{ role: 'Admin' }, { role: 'SalesTeamLead' }, { password: 'short' }, { mobile: 'wrong' }, { city: '' }, { sourceId: 'invalid' }, { fullName: {} }]) {
    const f = fixture();
    assert.equal((await f.request('POST', { ...f.payload, ...overrides })).code, 400);
    assert.equal(f.seen.user, undefined);
    assert.equal(f.seen.docs, undefined);
  }
});
test('missing source and duplicate mobile do not create accounts or services', async () => {
  for (const options of [{ sourceMissing: true }, { duplicate: true }]) {
    const f = fixture(options);
    assert.ok([400, 409].includes((await f.request()).code));
    assert.equal(f.seen.docs, undefined);
    assert.equal(f.seen.user, undefined);
  }
});
test('partial service insertion is cleaned up before returning an error', async () => {
  const f = fixture({ failInsert: true });
  assert.equal((await f.request()).code, 500);
  assert.equal(f.seen.user, undefined);
  assert.equal(f.seen.cleanup.length, 2);
  assert.equal(f.seen.cleanup[0].laboratoryId, f.seen.docs[0].laboratoryId);
});

test('provider metrics show laboratory requests and radiology referrals without doctor or pharmacy statistics', async () => {
  const filename = require.resolve('../services/salesMetrics'), native = createRequire(filename), module = { exports: {} };
  const labRequests = { collection: { name: 'labrequests' }, aggregate: async () => [{ _id: 'rad', value: 3, commission: 5 }, { _id: 'lab', value: 2, commission: 1 }] };
  const exams = { collection: { name: 'exams' }, aggregate: async () => [{ _id: 'lab', value: 4, commission: 6 }] };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console, require: name => name === '../models/LabRequest' ? labRequests : name === '../models/MedicalExamRequest' ? exams : name.startsWith('../models/') ? { collection: { name: name.slice(10) }, aggregate: async () => [] } : native(name) });
  const rows = await module.exports.customerMetrics([{ _id: 'rad', role: 'Radiology' }, { _id: 'lab', role: 'Lab' }]);
  assert.equal(rows[0].radiologyCount, 3);
  assert.equal(rows[0].vitaCommission, 5);
  assert.equal(rows[0].prescriptionCount, null);
  assert.equal(rows[1].labCount, 6);
  assert.equal(rows[1].vitaCommission, 7);
  assert.equal(rows[1].radiologyCount, null);
});
