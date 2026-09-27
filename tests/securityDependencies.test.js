const { test } = require('node:test');
const assert = require('node:assert/strict');
test('patched Firebase initializes and exposes messaging without sending any notification', async () => {
  const { initializeApp, deleteApp, cert } = require('firebase-admin/app');
  const { getMessaging } = require('firebase-admin/messaging');
  assert.equal(typeof cert, 'function');
  const app = initializeApp({ projectId: 'synthetic-security-test' }, 'synthetic-security-test');
  try { assert.equal(typeof getMessaging(app).send, 'function'); } finally { await deleteApp(app); }
});
test('patched UUID remains compatible with gaxios multipart request preparation', async () => {
  const { createRequire } = require('module');
  const uuid = createRequire(require.resolve('gaxios'))('uuid');
  assert.equal(uuid.validate(uuid.v4()), true);
  const { Gaxios } = require('gaxios');
  let options;
  const client = new Gaxios({ adapter: async config => { options = config; return { status: 200, data: 'synthetic', headers: {}, config, statusText: 'OK' }; } });
  await client.request({ url: 'https://example.invalid/synthetic', method: 'POST', multipart: [{ headers: { 'Content-Type': 'text/plain' }, content: 'test' }] });
  assert.match(options.headers['Content-Type'], /^multipart\/related; boundary=/);
  // Consume local stream; the adapter above never opens a network connection.
  for await (const chunk of options.body) assert.ok(chunk.length > 0);
});
