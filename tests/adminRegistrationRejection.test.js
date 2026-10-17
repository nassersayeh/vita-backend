const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function loadAdminController(mocks) {
  const filename = require.resolve('../controllers/adminController');
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    Buffer,
    console,
    process: { env: {} },
    require: (name) => (name in mocks ? mocks[name] : nativeRequire(name)),
  });
  return module.exports;
}

function response() {
  return {
    statusCode: 200,
    status(value) { this.statusCode = value; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('rejecting a pending registration deletes the user and their points', async () => {
  let deletedUserId;
  let deletedPointsUserId;
  const user = {
    _id: 'pending-user',
    fullName: 'Pending Pharmacy',
    mobileNumber: '',
    role: 'Pharmacy',
    country: 'Palestine',
    activationStatus: 'pending',
    save: async () => {},
  };
  const controller = loadAdminController({
    '../models/User': {
      findById: async () => user,
      findByIdAndDelete: async (id) => { deletedUserId = id; },
    },
    '../models/Points': {
      deleteOne: async ({ userId }) => { deletedPointsUserId = userId; },
    },
    '../models/AdminNotification': {},
    '../models/Order': {},
    '../models/Appointment': {},
    '../models/Financial': {},
    '../models/PotentialClientStatus': {},
    '../models/PointSettings': {},
    '../models/LandingAnalyticsEvent': {},
    '../models/DemoRequest': {},
    '../utils/assignDefaultInventory': { assignDefaultInventory: async () => 0 },
    axios: {},
    '../services/whatsappService': { isWhatsAppReady: async () => false },
  });
  const res = response();

  await controller.approveUser({
    params: { userId: 'pending-user' },
    body: { status: 'declined', requestType: 'registration' },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(deletedUserId, 'pending-user');
  assert.equal(deletedPointsUserId, 'pending-user');
  assert.match(res.body.message, /rejected and user deleted/i);
});

test('rejecting an active account without a pending plan request does not delete it', async () => {
  let deleted = false;
  const controller = loadAdminController({
    '../models/User': {
      findById: async () => ({ _id: 'active-user', activationStatus: 'active' }),
      findByIdAndDelete: async () => { deleted = true; },
    },
    '../models/Points': { deleteOne: async () => {} },
    '../models/AdminNotification': {},
    '../models/Order': {},
    '../models/Appointment': {},
    '../models/Financial': {},
    '../models/PotentialClientStatus': {},
    '../models/PointSettings': {},
    '../models/LandingAnalyticsEvent': {},
    '../models/DemoRequest': {},
    '../utils/assignDefaultInventory': { assignDefaultInventory: async () => 0 },
    axios: {},
  });
  const res = response();

  await controller.approveUser({
    params: { userId: 'active-user' },
    body: { status: 'declined', requestType: 'registration' },
  }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(deleted, false);
});
