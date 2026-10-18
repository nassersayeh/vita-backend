const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');

async function authenticate(user, invalidSignature = false) {
  const secret = 'isolated-approval-test-secret';
  const moduleObject = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../middleware/auth'), 'utf8'), {
    module: moduleObject, process: { env: { JWT_SECRET: secret } },
    require: name => name === 'jsonwebtoken' ? jwt : { findById: () => ({ select: async () => user }) },
  });
  const token = jwt.sign({ userId: 'doctor-id', role: 'Doctor' }, invalidSignature ? 'incorrect' : secret, { expiresIn: '1h' });
  let status; let body; let next = false;
  await moduleObject.exports({ header: () => `Bearer ${token}` }, {
    status(value) { status = value; return this; }, json(value) { body = value; },
  }, () => { next = true; });
  return { status, body, next };
}

test('pending doctors retain their session but cannot access protected data', async () => {
  const result = await authenticate({ activationStatus: 'pending' });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'ACCOUNT_PENDING_APPROVAL');
  assert.equal(result.next, false);
});
test('active doctors can access protected routes', async () => {
  assert.equal((await authenticate({ activationStatus: 'active' })).next, true);
});
test('declined doctors cannot access protected routes', async () => {
  const result = await authenticate({ activationStatus: 'declined' });
  assert.equal(result.status, 403);
  assert.equal(result.next, false);
});
test('missing users, invalid tokens and revoked sessions still require login', async () => {
  assert.equal((await authenticate(null)).status, 401);
  assert.equal((await authenticate({ activationStatus: 'pending' }, true)).status, 401);
  assert.equal((await authenticate({ activationStatus: 'active', passwordChangedAt: new Date(Date.now() + 1000) })).status, 401);
});
