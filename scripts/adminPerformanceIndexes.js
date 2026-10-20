require('dotenv').config();
const mongoose = require('mongoose');
const definitions = require('../utils/adminIndexes');
let connectionDeadline;

async function run() {
  connectionDeadline = setTimeout(() => { console.error('Database unavailable: index connection timed out'); process.exit(1); }, 30000);
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 15000 });
  clearTimeout(connectionDeadline);
  for (const [name, indexes] of Object.entries(definitions)) {
    const collection = mongoose.connection.collection(name);
    const existing = await collection.listIndexes().toArray().catch(error => {
      if (error.code === 26) return [];
      throw error;
    });
    for (const index of indexes) {
      const equivalent = existing.some(item => JSON.stringify(item.key) === JSON.stringify(index.key));
      if (equivalent) { console.log(`${name}: ${index.name} already covered`); continue; }
      if (process.argv.includes('--apply')) {
        await collection.createIndex(index.key, { name: index.name });
        console.log(`${name}: created ${index.name}`);
      } else console.log(`${name}: missing ${index.name} (use --apply)`);
    }
  }
}
run().catch(error => { console.error(error.name + ': index maintenance failed'); process.exitCode = 1; }).finally(async () => { clearTimeout(connectionDeadline); await mongoose.disconnect(); });
