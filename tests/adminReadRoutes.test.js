const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');

test('admin subscriptions authenticates once and starts its independent queries together', async () => {
  const filename = require.resolve('../routes/admin');
  const native = createRequire(filename);
  const module = { exports: {} };
  let authCalls = 0;
  const releases = [];
  const User = { find: () => ({ select() { return this; }, lean() { return new Promise(resolve => releases.push(() => resolve([]))); } }) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console,
    require(name) {
      if (name === '../middleware/auth') return (req, res, next) => { authCalls += 1; req.user = { role: req.testRole || 'Admin' }; next(); };
      if (name === '../models/User') return User;
      if (name.startsWith('../models/')) return {};
      if (name === '../controllers/adminController') return new Proxy({}, { get: () => (req, res) => res.json({}) });
      if (name === './adminSales') return express.Router();
      return native(name);
    }
  });
  const request = testRole => new Promise((resolve, reject) => {
    module.exports.handle({ method: 'GET', url: '/subscriptions', originalUrl: '/subscriptions', headers: {}, query: {}, testRole }, {
      statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { resolve({ status: this.statusCode, data }); }
    }, reject);
  });
  const response = request();
  assert.equal(authCalls, 1);
  assert.equal(releases.length, 3, 'all subscription queries start before any completes');
  releases.forEach(release => release());
  assert.equal((await response).status, 200);
  assert.equal((await request('Doctor')).status, 403);
  assert.equal(authCalls, 2, 'new requests still recheck authorization');
});
