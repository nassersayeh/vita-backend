const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  let filter;
  const exports = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/pharmacyController'), 'utf8'), {
    exports, console,
    require: () => ({ find(value) { filter = value; return { select: async () => [{ fullName: 'Selected pharmacy' }] }; } }),
  });
  return { controller: exports, filter: () => filter };
}

test('medical network requires explicit prescription selection, independently of ordering', async () => {
  const { controller, filter } = setup();
  let response;
  await controller.getAllPharmacies({ query: { network: 'true' } }, { json(value) { response = value; } });
  assert.equal(filter().prescriptionDispensingEnabled, true);
  assert.equal(filter().activationStatus, 'active');
  assert.equal(filter().isPublic.$ne, false);
  assert.equal(filter().patientOrderingEnabled, undefined);
  assert.equal(response.length, 1);
});

test('medicine ordering retains its independent pharmacy selection', async () => {
  const { controller, filter } = setup();
  await controller.getAllPharmacies({ query: {} }, { json() {} });
  assert.equal(filter().patientOrderingEnabled.$ne, false);
  assert.equal(filter().prescriptionDispensingEnabled, undefined);
});
