// Read-only measurements. Output contains timings/counts/sizes, never account data.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const deadline = setTimeout(() => { console.error('Database unavailable: measurement timed out'); process.exit(1); }, 30000);
async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 10000, socketTimeoutMS: 20000 });
  const users = mongoose.connection.collection('users');
  const summary = { fullName: 1, role: 1, city: 1, email: 1, mobileNumber: 1, activationStatus: 1, createdAt: 1 };
  const result = { measuredAt: new Date().toISOString(), counts: {}, reads: {}, plans: {} };
  result.counts.users = await users.countDocuments();
  const measure = async (label, query) => {
    const start = performance.now();
    const rows = await query.toArray();
    result.reads[label] = { rows: rows.length, responseBytes: Buffer.byteLength(JSON.stringify(rows)), elapsedMs: Math.round(performance.now() - start) };
  };
  await measure('previousProviderDirectory', users.find({}, { projection: summary }).sort({ createdAt: -1 }).maxTimeMS(10000));
  await measure('scopedDoctors', users.find({ role: 'Doctor' }, { projection: summary }).sort({ createdAt: -1 }));
  await measure('firstUsersPage', users.find({}, { projection: summary }).sort({ createdAt: -1, _id: -1 }).limit(50));
  for (const [name, filter] of [['firstUsersPage', {}], ['scopedDoctors', { role: 'Doctor' }]]) {
    const plan = await users.find(filter, { projection: summary }).sort({ createdAt: -1, _id: -1 }).limit(50).explain('executionStats');
    result.plans[name] = {
      documentsExamined: plan.executionStats.totalDocsExamined,
      keysExamined: plan.executionStats.totalKeysExamined,
      returned: plan.executionStats.nReturned,
      blockingSort: JSON.stringify(plan.queryPlanner.winningPlan).includes('"SORT"')
    };
  }
  const output = process.argv.find(value => value.startsWith('--out='))?.slice(6);
  if (output) { fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2)); }
  console.log(JSON.stringify(result));
}
run().catch(error => { console.error(error.name + ': performance measurement failed'); process.exitCode = 1; }).finally(async () => { clearTimeout(deadline); await mongoose.disconnect(); });
