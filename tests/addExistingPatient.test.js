const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const doctorId = 'a'.repeat(24);
const patientId = 'b'.repeat(24);

function setup() {
  const connections = [];
  const doctor = { patients: [], save: async () => {} };
  let searchFilter;
  const User = {
    findById: async () => doctor,
    findOne: query => query.role === 'Doctor' ? Promise.resolve(doctor) : { select: async () => ({ _id: patientId, role: 'User' }) },
    find: query => { searchFilter = query; return { select: () => ({ limit: async () => [] }) }; },
  };
  class Request {
    constructor(data) { Object.assign(this, data); }
    async save() { connections.push(this); }
    static async findOne() { return null; }
  }
  const exports = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/doctorPatientController'), 'utf8'), {
    exports, console: { log() {}, error() {} },
    require: name => name === '../models/User' ? User : name === '../models/DoctorPatientRequest' ? Request : {},
  });
  return { controller: exports, connections, doctor, filter: () => searchFilter };
}

async function invoke(handler, req) {
  let status = 200; let body;
  await handler(req, { status(value) { status = value; return this; }, json(value) { body = value; } });
  return { status, body };
}

test('doctor adds an existing patient immediately to both patient relationship stores', async () => {
  const { controller, connections, doctor } = setup();
  const result = await invoke(controller.addExistingPatient, { user: { _id: doctorId, role: 'Doctor' }, params: { doctorId }, body: { patientId } });
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(connections[0].status, 'accepted');
  assert.equal(connections[0].patient, patientId);
  assert.deepEqual(doctor.patients, [patientId]);
});

test('doctor cannot add a patient on behalf of another doctor', async () => {
  const { controller, connections } = setup();
  const result = await invoke(controller.addExistingPatient, { user: { _id: 'c'.repeat(24), role: 'Doctor' }, params: { doctorId }, body: { patientId } });
  assert.equal(result.status, 403);
  assert.equal(connections.length, 0);
});

test('search matches either ID or mobile and restricts results to patients', async () => {
  const { controller, filter } = setup();
  const result = await invoke(controller.searchPatients, { user: { role: 'Doctor' }, query: { mobileNumber: '123456789' } });
  assert.equal(result.status, 200);
  assert.equal(filter().role, 'User');
  assert.equal(filter().$or[0].mobileNumber.$regex, '123456789');
  assert.equal(filter().$or[1].idNumber.$regex, '123456789');
});

test('search rejects query objects instead of passing them into database filters', async () => {
  const { controller } = setup();
  assert.equal((await invoke(controller.searchPatients, { user: { role: 'Doctor' }, query: { mobileNumber: { $ne: '' } } })).status, 400);
});
