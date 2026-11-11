const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('realized patient order commissions reach patient, pharmacy and team totals', async () => {
  const pipelines = [];
  const module = { exports: {} };
  const empty = { collection: { name: 'test' }, aggregate: async () => [] };
  const Order = { aggregate: async pipeline => {
    pipelines.push(pipeline);
    const group = pipeline.find(stage => stage.$group)?.$group;
    if (group?._id === '$user' && group.value.$sum === '$vitaCommissionAmount') return [{ _id: 'patient', value: 0.9 }];
    if (group?._id === '$pharmacyId') return [{ _id: 'pharmacy', value: 0.9 }];
    if (group?._id === '$owners') return [{ _id: 'manager', value: 0.9 }];
    return [];
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/salesMetrics'), 'utf8'), {
    module, require: name => name.endsWith('/Order') ? Order : empty,
  });
  const rows = await module.exports.customerMetrics([{ _id: 'patient', role: 'User' }, { _id: 'pharmacy', role: 'Pharmacy' }]);
  assert.equal(rows[0].vitaCommission, 0.9);
  assert.equal(rows[1].vitaCommission, 0.9);
  const totals = await module.exports.teamCommissions(['manager']);
  assert.equal(totals.get('manager'), 0.9);
  const commissionPipelines = pipelines.filter(p => p[0].$match.pharmacyPricedAt);
  assert.equal(commissionPipelines.length, 3);
  for (const pipeline of commissionPipelines) {
    assert.equal(JSON.stringify(pipeline[0].$match.status), JSON.stringify({ $in: ['delivered', 'completed'] }));
    assert.equal(pipeline[0].$match.adminApprovalStatus.$ne, 'rejected');
  }
  const team = commissionPipelines.find(p => p.some(stage => stage.$project));
  assert.equal(JSON.stringify(team.find(stage => stage.$project).$project.owners), JSON.stringify({ $setUnion: ['$provider.salesManager', '$patientOwner.salesManager'] }));
});
