const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { serviceTotals } = require('../utils/patientServiceBooking');
const centerId = 'aaaaaaaaaaaaaaaaaaaaaaaa',
  testId = 'bbbbbbbbbbbbbbbbbbbbbbbb';

function setup({ offered = true, centerAvailable = true } = {}) {
  const seen = {};
  const query = (result) => ({
    select() {
      return this;
    },
    sort() {
      return this;
    },
    lean: async () => result,
  });
  const mocks = {
    '../middleware/auth': (req, res, next) => (req.user ? next() : res.status(401).json({})),
    '../models/User': {
      find: (filter) => {
        seen.centers = filter;
        return query([{ _id: centerId }]);
      },
      findOne: (filter) => {
        seen.center = filter;
        return query(centerAvailable ? { _id: centerId } : null);
      },
    },
    '../models/MedicalTest': {
      find: (filter) => {
        seen.services = filter;
        return query(offered ? [{ _id: testId, name: 'Test', price: 100 }] : []);
      },
    },
    '../models/LabRequest': {
      create: async (value) => {
        seen.created = value;
        return { _id: 'request', ...value };
      },
    },
  };
  const filename = require.resolve('../routes/patientServices'),
    native = createRequire(filename),
    module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    require: (name) => (name in mocks ? mocks[name] : native(name)),
  });
  const request = (url, method = 'GET', type = 'laboratory', body = {}, role = 'User') =>
    new Promise((resolve, reject) => {
      module.exports.handle(
        {
          url,
          method,
          headers: {},
          query: { type },
          body,
          user: role ? { _id: 'real-patient', role } : undefined,
        },
        {
          code: 200,
          status(code) {
            this.code = code;
            return this;
          },
          json(body) {
            resolve({ code: this.code, body });
          },
        },
        reject,
      );
    });
  return { request, seen };
}

test('center/service lists are scoped to the requested type and the actual provider', async () => {
  for (const type of ['laboratory', 'radiology']) {
    const { request, seen } = setup();
    assert.equal((await request('/centers', 'GET', type)).code, 200);
    assert.equal(seen.centers.role, type === 'radiology' ? 'Radiology' : 'Lab');
    assert.equal(seen.centers.activationStatus, 'active');
    assert.equal((await request(`/centers/${centerId}/services`, 'GET', type)).code, 200);
    assert.equal(seen.services.type, type);
    assert.equal(seen.services.$or[0].providerId, centerId);
    assert.equal(seen.services.$or[1].providerId, null);
    assert.equal(seen.services.$or[1].createdBy, centerId);
  }
});

test('patient self-request needs no doctor; identity and discounted prices are calculated on the server', async () => {
  const { request, seen } = setup();
  const result = await request('/requests', 'POST', 'radiology', {
    type: 'radiology',
    centerId,
    testIds: [testId],
    patientId: 'someone-else',
    totalCost: 1,
  });
  assert.equal(result.code, 201);
  assert.equal(seen.created.patientId, 'real-patient');
  assert.equal(seen.created.doctorId, undefined);
  assert.equal(seen.created.labId, centerId);
  assert.equal(seen.created.originalCost, 100);
  assert.equal(seen.created.totalCost, 80);
  assert.equal(seen.created.discountAmount, 20);
  assert.equal(seen.created.status, 'pending');
  assert.equal(seen.created.pricingItems[0].testId, testId);
});

test('unavailable centers, foreign services, duplicates and unauthorized requests are rejected', async () => {
  const body = { type: 'laboratory', centerId, testIds: [testId] };
  assert.equal(
    (await setup({ centerAvailable: false }).request('/requests', 'POST', 'laboratory', body)).code,
    404,
  );
  assert.equal(
    (await setup({ offered: false }).request('/requests', 'POST', 'laboratory', body)).code,
    400,
  );
  assert.equal(
    (
      await setup().request('/requests', 'POST', 'laboratory', {
        ...body,
        testIds: [testId, testId],
      })
    ).code,
    400,
  );
  assert.equal((await setup().request('/centers', 'GET', 'laboratory', {}, 'Doctor')).code, 403);
  assert.equal((await setup().request('/centers', 'GET', 'laboratory', {}, null)).code, 401);
});

test('rounding is consistent per service and unpriced services cannot generate false totals', () => {
  const value = serviceTotals([
    { _id: testId, price: 12.33 },
    { _id: centerId, price: 15 },
  ]);
  assert.equal(value.originalCost, 27.33);
  assert.equal(value.totalCost, 21.86);
  assert.equal(value.discountAmount, 5.47);
  assert.throws(
    () => serviceTotals([{ price: undefined }]),
    (error) => error.status === 400,
  );
});
