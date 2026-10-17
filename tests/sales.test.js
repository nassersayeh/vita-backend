const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function load(file, mocks) {
  const filename = require.resolve(file), native = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, Buffer, console, process: { env: { JWT_SECRET: 'test-only-signing-secret' } }, require: name => name in mocks ? mocks[name] : native(name) });
  return module.exports;
}
function request(router, method, url, user, body = {}, query = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No response')), 3000);
    const res = { set() { return this; }, statusCode: 200, status(value) { this.statusCode = value; return this; }, json(body) { clearTimeout(timeout); resolve({ status: this.statusCode, body }); } };
    router.handle({ method, url, originalUrl: url, headers: {}, user, body, query }, res, error => { clearTimeout(timeout); reject(error || new Error('Unhandled route')); });
  });
}
const auth = (req, res, next) => req.user ? next() : res.status(401).json({});
const limiter = (req, res, next) => next();
function router(mocks = {}) {
  return load('../routes/sales', {
    '../middleware/auth': auth,
    '../middleware/authRateLimiter': { salesSignupLimiter: limiter, salesPasswordLimiter: limiter },
    '../models/User': {}, '../services/salesMetrics': { customerMetrics: async rows => rows },
    '../controllers/authController': { signup: () => { throw new Error('Unexpected signup'); } }, ...mocks,
  });
}
test('sales endpoints reject anonymous and other roles', async () => {
  const app = router();
  for (const [method, path] of [['GET', '/customers'], ['POST', '/customers'], ['POST', '/password']]) {
    assert.equal((await request(app, method, path)).status, 401);
    for (const role of ['Doctor', 'Pharmacy', 'User', 'Admin']) assert.equal((await request(app, method, path, { role })).status, 403);
  }
});
test('customer listing ignores attacker owner filters and paginates only own customers', async () => {
  const filters = [];
  const chain = { select(fields) { assert.ok(!fields.includes('password')); return this; }, sort() { return this; }, skip(n) { assert.equal(n, 25); return this; }, limit(n) { assert.equal(n, 25); return this; }, lean: async () => [{ fullName: 'own customer' }] };
  const app = router({ '../models/User': { find(filter) { filters.push(filter); return chain; }, countDocuments: async filter => { filters.push(filter); return 26; } } });
  const result = await request(app, 'GET', '/customers', { _id: 'manager-A', role: 'SalesManager' }, {}, { page: '2', salesManager: 'manager-B' });
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 26);
  for (const filter of filters) assert.equal(filter.salesManager, 'manager-A');
});
test('registration binds manager to authenticated actor and rejects privileged roles', async () => {
  const app = router({ '../controllers/authController': { signup: (req, res) => res.json({ manager: req.salesManagerId }) } });
  const user = { _id: 'manager-A', role: 'SalesManager' };
  for (const role of ['Admin', 'SalesManager', 'User']) assert.equal((await request(app, 'POST', '/customers', user, { role })).status, 400);
  const response = await request(app, 'POST', '/customers', user, { role: 'Doctor', salesManagerId: 'manager-B' });
  assert.equal(response.body.manager, 'manager-A');
});
test('password changes require current password and atomically invalidate old sessions', async () => {
  let mutation;
  const app = router({ bcryptjs: { compare: async value => value === 'current-pass', hash: async () => 'new-hash' }, '../models/User': { updateOne: async (filter, update) => { mutation = { filter, update }; return { modifiedCount: 1 }; } } });
  const user = { _id: 'manager-A', role: 'SalesManager', fullName: 'Test Manager', password: 'old-hash' };
  assert.equal((await request(app, 'POST', '/password', user, { currentPassword: 'bad', newPassword: 'strong-12345' })).status, 400);
  assert.equal(mutation, undefined);
  assert.equal((await request(app, 'POST', '/password', user, { currentPassword: 'current-pass', newPassword: 'strong-12345' })).status, 200);
  assert.equal(mutation.filter._id, 'manager-A');
  assert.equal(mutation.filter.password, 'old-hash');
  assert.equal(mutation.update.$set.password, 'new-hash');
  assert.ok(mutation.update.$set.passwordChangedAt);
});
test('shared signup saves attribution and specialty, keeps approval pending and never returns customer token to sales', async () => {
  let saved;
  class User {
    constructor(fields) { Object.assign(this, fields); this._id = 'customer'; this.activationStatus = 'pending'; saved = this; }
    static async findOne() { return null; }
    async save() { return this; }
  }
  const controller = load('../controllers/authController', {
    '../models/User': User, '../models/Otp': {}, dotenv: { config() {} },
    '../services/whatsappService': { isWhatsAppReady: async () => false },
    nodemailer: { createTransport: () => ({}) },
    jsonwebtoken: { sign() { throw new Error('Sales must not mint customer token'); } },
    bcryptjs: { hash: async () => 'hashed' },
  });
  let result;
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { result = body; } };
  await controller.signup({ salesManagerId: 'manager-A', body: { fullName: 'Dentist', mobile: '0591111111', password: 'strong-12345', country: 'Palestine', city: 'Ramallah', idNumber: '123456789', address: 'Main street', role: 'Doctor', specialty: 'Dentistry', salesManager: 'manager-B', activationStatus: 'active' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(saved.salesManager, 'manager-A');
  assert.equal(saved.registeredBy, 'manager-A');
  assert.equal(saved.specialty, 'Dentistry');
  assert.equal(result.user.activationStatus, 'pending');
  assert.equal(result.token, undefined);
  assert.equal(result.autoLogin, undefined);
});

test('only lead can create staff, ignoring privileged role and forged attribution', async () => {
  let created;
  const app = router({ bcryptjs: { hash: async () => 'hashed' }, '../models/User': {
    findOne: async () => null, create: async fields => { created = fields; return { ...fields, _id: 'staff-id' }; },
  } });
  const body = { fullName: 'New Employee', mobile: '0591234567', password: 'Secure-4567', role: 'Admin', salesCreatedBy: 'forged' };
  assert.equal((await request(app, 'POST', '/staff', { _id: 'staff', role: 'SalesManager' }, body)).status, 403);
  assert.equal(created, undefined);
  const result = await request(app, 'POST', '/staff', { _id: 'lead', role: 'SalesTeamLead' }, body);
  assert.equal(result.status, 201);
  assert.equal(created.role, 'SalesManager');
  assert.equal(created.salesCreatedBy, 'lead');
  assert.equal(created.activationStatus, 'active');
  assert.equal(result.body.user.password, undefined);
  assert.equal(result.body.token, undefined);
});
test('staff creation rejects invalid input and duplicate mobile', async () => {
  const app = router({ '../models/User': { findOne: async () => ({ _id: 'existing' }), create() { throw new Error('Must not create'); } } });
  const actor = { _id: 'lead', role: 'SalesTeamLead' };
  assert.equal((await request(app, 'POST', '/staff', actor, { fullName: {}, mobile: '0591234567', password: 'Secure-4567' })).status, 400);
  assert.equal((await request(app, 'POST', '/staff', actor, { fullName: 'Someone', mobile: '123', password: 'Secure-4567' })).status, 400);
  assert.equal((await request(app, 'POST', '/staff', actor, { fullName: 'Someone', mobile: '+970591234567', password: 'Secure-4567' })).status, 409);
});
test('lead customer registration preserves authenticated attribution', async () => {
  const app = router({ '../controllers/authController': { signup: (req, res) => res.json({ owner: req.salesManagerId }) } });
  const result = await request(app, 'POST', '/customers', { _id: 'lead', role: 'SalesTeamLead' }, { role: 'Pharmacy', salesManagerId: 'forged' });
  assert.equal(result.status, 200);
  assert.equal(result.body.owner, 'lead');
});

test('optional specialty supports web, mobile and sales registration without weakening supplied-value validation', async () => {
  let saved;
  class User {
    constructor(fields) { Object.assign(this, fields); this._id = 'customer'; this.activationStatus = 'pending'; saved = this; }
    static async findOne() { return null; }
    async save() { return this; }
  }
  const controller = load('../controllers/authController', {
    '../models/User': User, '../models/Otp': {}, dotenv: { config() {} },
    '../services/whatsappService': { isWhatsAppReady: async () => false },
    nodemailer: { createTransport: () => ({}) },
    jsonwebtoken: { sign: () => 'test-customer-token' }, bcryptjs: { hash: async () => 'hashed' },
  });
  for (const channel of ['web', 'mobile', 'sales']) {
    for (const specialty of [undefined, null, '', '   ', 'Dentistry']) {
      const req = { body: { fullName: 'Provider', mobile: '0591111111', password: 'strong-12345', country: 'Palestine', city: 'Ramallah', idNumber: '123456789', address: 'Main street', role: 'Doctor', registrationChannel: channel === 'mobile' ? 'mobile' : undefined, ...(specialty !== undefined ? { specialty } : {}) }, ...(channel === 'sales' ? { salesManagerId: 'manager-A' } : {}) };
      let result;
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { result = body; } };
      await controller.signup(req, res);
      assert.equal(res.statusCode, 201, `${channel}: ${JSON.stringify(specialty)}`);
      assert.equal(saved.specialty, specialty === 'Dentistry' ? 'Dentistry' : undefined);
      assert.equal(result.token, channel === 'sales' ? undefined : 'test-customer-token');
    }
  }
  for (const specialty of [{ $ne: null }, [], 123, 'Unknown Specialty']) {
    saved = undefined;
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() {} };
    await controller.signup({ body: { role: 'Doctor', specialty } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(saved, undefined);
  }
});
