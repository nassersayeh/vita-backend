const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const patientId = '111111111111111111111111';
function setup(debts = [], conflicts = 0) {
  const calls = [];
  const file = require.resolve('../controllers/partnerAccountsController');
  const native = createRequire(file), module = { exports: {} };
  const financial = { updateOne: async (filter, update, options) => { calls.push({ filter, update, options }); return { modifiedCount: update.$set ? (conflicts-- > 0 ? 0 : 1) : 1 }; }, findOne: () => ({ lean: async () => ({ _id: 'ledger', debts }) }) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, require: name => name === '../models/Financial' ? financial : name === '../models/User' ? { exists: async () => true } : native(name) });
  return { calls, async send(body, patients = [patientId]) { let result; const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { result = { status: this.statusCode, body }; } }; await module.exports.create({ user: { _id: 'doctor', patients }, body }, res); return result; } };
}
test('payment pays oldest own patient debts, preserves original amounts and records server timestamps', async () => {
 const debts = [
  { _id: 'new', patientId, amount: 60, status: 'pending', date: '2026-02-01' },
  { _id: 'old', patientId, amount: 50, status: 'pending', date: '2026-01-01' },
  { _id: 'insurance', patientId, debtorType: 'insurance', amount: 100, status: 'pending', date: '2025-01-01' },
  { _id: 'foreign', patientId: 'other', amount: 40, status: 'pending', date: '2025-01-01' },
 ];
 const app = setup(debts);
 assert.equal((await app.send({ type: 'payment', patientId, amount: 80, reason: 'Follow up', date: '2000-01-01' })).status, 201);
 const write = app.calls.at(-1);
 assert.equal(write.filter.doctorId, 'doctor');
 assert.equal(write.update.$set.debts[0].amount, 30);
 assert.equal(write.update.$set.debts[1].amount, 0);
 assert.equal(write.update.$set.debts[1].status, 'paid');
 assert.equal(write.update.$set.debts[1].originalAmount, 50);
 assert.equal(write.update.$set.debts[2].amount, 100);
 assert.equal(write.update.$set.debts[3].amount, 40);
 assert.equal(write.update.$push.transactions.amount, 80);
 assert.equal(write.update.$push.transactions.description, 'Follow up');
 assert.ok(new Date(write.update.$push.transactions.date).getFullYear() > 2000);
 assert.equal(debts[1].amount, 50);
});
test('payments without debt or over the debt retain the complete amount; conflicts retry before charging', async () => {
 for (const balance of [0, 20]) {
  const app = setup(balance ? [{ patientId, amount: balance, date: new Date(), status: 'pending' }] : [], 1);
  assert.equal((await app.send({ type: 'payment', patientId, amount: 50, reason: 'Visit' })).status, 201);
  const write = app.calls.at(-1).update;
  assert.equal(write.$inc.totalEarnings, 50);
  assert.equal(write.$push.transactions.amount, 50);
  if (balance) assert.equal(write.$set.debts[0].amount, 0);
 }
});
test('debt requires linked patient and a reason; expense has no patient and validates other details', async () => {
 const app = setup();
 assert.equal((await app.send({ type: 'debt', patientId, amount: 20, reason: 'Treatment' }, [])).status, 403);
 for (const amount of [-1, 0, NaN, Infinity, '20', 1.001]) assert.equal((await app.send({ type: 'debt', patientId, amount, reason: 'Treatment' })).status, 400);
 assert.equal((await app.send({ type: 'debt', patientId, amount: 20, reason: '' })).status, 400);
 assert.equal((await app.send({ type: 'debt', patientId, amount: 20, reason: 'Treatment' })).status, 201);
 assert.equal(app.calls.at(-1).update.$push.debts.originalAmount, 20);
 assert.equal((await app.send({ type: 'expense', amount: 50, category: 'other' })).status, 400);
 assert.equal((await app.send({ type: 'expense', amount: 50, category: '__proto__' })).status, 400);
 for (const category of ['rent', 'salary', 'equipment', 'medicine', 'tools', 'personal', 'other']) {
  assert.equal((await app.send({ type: 'expense', amount: 50, category, reason: 'Details', patientId: 'ignored' }, [])).status, 201);
  assert.equal(app.calls.at(-1).update.$push.expenses.patientId, undefined);
  assert.equal(app.calls.at(-1).update.$inc.totalExpenses, 50);
 }
});
