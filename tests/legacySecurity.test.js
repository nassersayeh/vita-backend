const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const { createRequire } = require('module');
function load(file) {
  const filename = require.resolve(file), nativeRequire = createRequire(filename), module = { exports: {} };
  const unexpected = () => { throw new Error('A denied request reached the database/controller'); };
  const sentinel = new Proxy(function () {}, { get: () => unexpected });
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, console, Buffer, process, require: name => {
    if (name.endsWith('/middleware/auth')) return (req, res, next) => req.user ? next() : res.status(401).json({ message: 'Unauthorized' });
    if (name.startsWith('../controllers/')) return new Proxy({}, { get: () => unexpected });
    if (name.startsWith('../models/')) return sentinel;
    return nativeRequire(name);
  } });
  return module.exports;
}
function request(router, method, url, user, body = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Unexpected DB access or missing response')), 2000);
    const req = { method, url, originalUrl: url, headers: {}, user, body, query: {} };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { clearTimeout(timer); resolve({ status: this.statusCode, body }); } };
    router.handle(req, res, error => { clearTimeout(timer); error ? reject(error) : resolve({ status: 404 }); });
  });
}
test('legacy admin and profile routes reject anonymous and non-admin privilege changes before database access', async () => {
  for (const [file, method, url] of [
    ['../routes/admin', 'PUT', '/users/victim'], ['../routes/admin', 'DELETE', '/users/victim'],
    ['../routes/profileRoutes', 'PUT', '/users/victim/role'], ['../routes/profileRoutes', 'PUT', '/users/victim/status'],
    ['../routes/profileRoutes', 'GET', '/allusers'], ['../routes/profile', 'PUT', '/activate/victim'],
  ]) {
    const router = load(file);
    assert.equal((await request(router, method, url)).status, 401, `${file}: anonymous`);
    assert.equal((await request(router, method, url, { _id: 'attacker', role: 'Doctor' })).status, 403, `${file}: doctor`);
  }
});
test('legacy self-service profile routes reject writes to another account', async () => {
  for (const [file, url] of [['../routes/user', '/victim'], ['../routes/user', '/victim/health-profile'], ['../routes/profile', '/victim'], ['../routes/Settings', '/victim/settings'], ['../routes/updateDeviceToken', '/update-device-token/victim']]) {
    const router = load(file);
    assert.equal((await request(router, 'PUT', url)).status, 401);
    assert.equal((await request(router, 'PUT', url, { _id: 'attacker', role: 'User' })).status, 403);
  }
});
test('pharmacy inventory rejects foreign ownership and non-pharmacy accounts', async () => {
  const router = load('../routes/pharmacyInventoryRoutes');
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    const url = '/pharmacy/victim/drug/drug';
    assert.equal((await request(router, method, url)).status, 401);
    assert.equal((await request(router, method, url, { _id: 'attacker', role: 'Pharmacy' })).status, 403);
    assert.equal((await request(router, method, url, { _id: 'victim', role: 'User' })).status, 403);
  }
});
test('retired oversight login cannot bypass primary login controls', async () => {
  assert.equal((await request(load('../routes/oversightRoutes'), 'POST', '/login', undefined, { username: { $ne: null }, password: 'wrong' })).status, 410);
});
