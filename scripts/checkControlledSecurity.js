// Read-only pre-demo check. Never print URIs, passwords, tokens or patient records.
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
async function main() {
  const report = { checkedAt: new Date().toISOString(), environment: {
    jwtSecretConfigured: (process.env.JWT_SECRET || '').length >= 32,
    signingKeyConfigured: (process.env.CONTROLLED_SIGNING_KEY || '').length >= 32,
    productionMode: process.env.NODE_ENV === 'production',
    explicitCorsOrigins: Boolean(process.env.CORS_ORIGINS?.trim()),
  } };
  const connection = await mongoose.createConnection(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 5000 }).asPromise();
  try {
    const hello = await connection.db.admin().command({ hello: 1 });
    report.database = { supportsTransactions: Boolean(hello.setName || hello.msg === 'isdbgrid') };
    const rx = connection.collection('controlledprescriptions');
    const indexes = await rx.indexes().catch(error => { if (error.code === 26) return []; throw error; });
    report.database.uniqueSerialIndex = indexes.some(index => index.unique && index.key.serial === 1);
    report.database.uniqueIssueRequestIndex = indexes.some(index => index.unique && index.key.doctorId === 1 && index.key.issueRequestId === 1);
    report.database.unsignedIssuedPrescriptions = await rx.countDocuments({ issuedAt: { $type: 'date' }, $or: [{ integrityVersion: { $ne: 1 } }, { integritySeal: { $exists: false } }] });
    report.database.unresolvedDispensingLocks = await rx.countDocuments({ pharmacyWriteLock: { $ne: null } });
    const accounts = await connection.collection('oversightaccounts').find({}, { projection: { type: 1, status: 1, password: 1, phone: 1, email: 1 } }).toArray();
    report.authorities = accounts.map(account => ({ type: account.type, active: account.status === 'active', passwordHashAcceptable: /^\$2[aby]\$(?:1[0-9]|2[0-9]|3[01])\$/.test(account.password || ''), placeholderContacts: String(account.email || '').endsWith('.invalid') || /^0{4}/.test(account.phone || '') }));
    console.log(JSON.stringify(report, null, 2));
  } finally { await connection.close(); }
}
main().catch(error => { console.error('Security readiness check failed:', error.name, error.code || ''); process.exitCode = 1; });
