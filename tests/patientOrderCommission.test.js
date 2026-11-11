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
    if (group?._id === null) return [{ _id: null, value: 0.9 }];
    return [];
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/salesMetrics'), 'utf8'), {
    module, require: name => name === '../utils/patientOrderCommission' ? require(name) : name.endsWith('/Order') ? Order : empty,
  });
  const rows = await module.exports.customerMetrics([{ _id: 'patient', role: 'User' }, { _id: 'pharmacy', role: 'Pharmacy' }]);
  assert.equal(rows[0].vitaCommission, 0.9);
  assert.equal(rows[1].vitaCommission, 0.9);
  const totals = await module.exports.teamCommissions(['manager']);
  assert.equal(totals.get('manager'), 0.9);
  const breakdown = await module.exports.teamCommissions(['manager'], { breakdown: true });
  assert.equal(breakdown.get('manager').medicineCommission, 0.9);
  assert.equal(breakdown.get('manager').vitaCommission, 0.9);
  assert.equal(breakdown.get('manager').diagnosticCommission, 0);
  const unique = await module.exports.teamCommissions(['manager', 'other-manager'], { breakdown: true, unique: true });
  assert.equal(unique.get('null').vitaCommission, 0.9);
  const uniquePipeline = pipelines.find(p => p.some(stage => stage.$group?._id === null));
  assert.ok(!uniquePipeline.some(stage => stage.$unwind === '$owners'));
  const commissionPipelines = pipelines.filter(p => p[0].$match.pharmacyPricedAt);
  assert.equal(commissionPipelines.length, 5);
  for (const pipeline of commissionPipelines) {
    assert.equal(JSON.stringify(pipeline[0].$match.status), JSON.stringify({ $in: ['delivered', 'completed'] }));
    assert.equal(pipeline[0].$match.adminApprovalStatus.$ne, 'rejected');
  }
  const team = commissionPipelines.find(p => p.some(stage => stage.$project));
  assert.equal(JSON.stringify(team.find(stage => stage.$project).$project.owners), JSON.stringify({ $setUnion: ['$provider.salesManager', '$patientOwner.salesManager'] }));
  const beforePlatform = pipelines.length;
  const platform = await module.exports.platformCommissions();
  assert.equal(platform.vitaCommission, 0.9);
  assert.equal(platform.currency, 'ILS');
  assert.equal(platform.period, 'all_time');
  const platformPipeline = pipelines[beforePlatform];
  assert.ok(!platformPipeline.some(stage => stage.$match?.owners || stage.$unwind === '$owners'));
});
