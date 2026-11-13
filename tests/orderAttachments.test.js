const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const express = require('express');
const { createUploadedFilesMiddleware } = require('../utils/uploadedFiles');
const source = fs.readFileSync(path.join(__dirname, '../../vita-front/src/utils/orderAttachmentUrl.js'), 'utf8')
  .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/m, '').replace('export function', 'function');
const context = { URL, API_BASE_URL: '/api' };vm.createContext(context);vm.runInContext(source, context);
const resolve = context.getOrderAttachmentUrl;
test('old website, API, relative and Windows upload links all resolve through the API', () => {
  for (const fileUrl of ['https://www.vita.ps/uploads/prescriptions/test.png', 'https://api.vita.ps/uploads/prescriptions/test.png', 'http://localhost:5000/uploads/prescriptions/test.png', '/uploads/prescriptions/test.png', '/api/uploads/prescriptions/test.png', 'uploads/prescriptions/test.png', 'C:\\backend\\uploads\\prescriptions\\test.png']) {
    assert.equal(resolve({ fileUrl }), '/api/uploads/prescriptions/test.png', fileUrl);
  }
  assert.equal(resolve('https://www.vita.ps/uploads/prescriptions/test.pdf?download=1'), '/api/uploads/prescriptions/test.pdf');
  assert.equal(resolve({ filename: 'test image.png' }), '/api/uploads/prescriptions/test%20image.png');
  assert.equal(resolve({ filePath: 'uploads/prescriptions/test.png' }, 'http://localhost:5000/api/'), 'http://localhost:5000/api/uploads/prescriptions/test.png');
});
test('missing and unsafe attachment URLs never navigate to the website or run scripts', () => {
  for (const input of [null, {}, '', 'javascript:alert(1)', 'data:text/html,test', 'https://example.com/', { filename: '../secret' }]) assert.equal(resolve(input), '');
});
test('API upload links return actual images and PDFs; missing files never return the SPA', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vita-upload-test-'));
  fs.mkdirSync(path.join(root, 'prescriptions'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(path.join(root, 'prescriptions/test.png'), png);
  fs.writeFileSync(path.join(root, 'prescriptions/test.pdf'), '%PDF-1.4\n');
  const app = express(), middleware = createUploadedFilesMiddleware(root);
  app.use('/api/uploads', middleware);app.use('/uploads', middleware);
  app.use((req, res) => res.type('html').send('<html>home</html>'));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: 'File unavailable' }));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const prefix of ['/api/uploads', '/uploads']) {
    const image = await fetch(`${origin}${prefix}/prescriptions/test.png`);
    assert.equal(image.status, 200);assert.match(image.headers.get('content-type'), /^image\/png/);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    const pdf = await fetch(`${origin}${prefix}/prescriptions/test.pdf`);assert.match(pdf.headers.get('content-type'), /^application\/pdf/);
    const missing = await fetch(`${origin}${prefix}/prescriptions/missing.png`);assert.equal(missing.status, 404);assert.match(missing.headers.get('content-type'), /json/);
  }
});

test('local attachments win and only missing prescription files use the configured server fallback', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vita-upload-fallback-test-'));
  fs.mkdirSync(path.join(root, 'prescriptions'));
  fs.writeFileSync(path.join(root, 'prescriptions/local.png'), 'local image');
  const app = express();
  app.use('/api/uploads', createUploadedFilesMiddleware(root, { fallbackOrigin: 'https://api.vita.ps' }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: 'File unavailable' }));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const local = await fetch(`${origin}/api/uploads/prescriptions/local.png`, { redirect: 'manual' });
  assert.equal(local.status, 200);assert.equal(await local.text(), 'local image');
  const missing = await fetch(`${origin}/api/uploads/prescriptions/1794487516684-313443460.png`, { redirect: 'manual' });
  assert.equal(missing.status, 302);
  assert.equal(missing.headers.get('location'), 'https://api.vita.ps/uploads/prescriptions/1794487516684-313443460.png');
  assert.equal(missing.headers.get('cache-control'), 'no-store');
  const unrelated = await fetch(`${origin}/api/uploads/private.txt`, { redirect: 'manual' });
  assert.equal(unrelated.status, 404);
});

test('a missing production file never redirects back to the same server', async () => {
  const middleware = createUploadedFilesMiddleware('missing-test-directory', { fallbackOrigin: 'https://api.vita.ps' });
  const req = { method: 'GET', url: '/prescriptions/missing.png', originalUrl: '/api/uploads/prescriptions/missing.png', path: '/prescriptions/missing.png', headers: { host: 'api.vita.ps' }, get: () => 'api.vita.ps' };
  const result = await new Promise(resolve => middleware(req, { redirect: () => assert.fail('Redirect loop') }, resolve));
  assert.equal(result.status, 404);
});
