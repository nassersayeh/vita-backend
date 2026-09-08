require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const users = mongoose.connection.collection('users');
  await users.updateMany({ mobileUniquenessScope: { $exists: false } }, { $set: { mobileUniquenessScope: 'global' } });
  const indexes = await users.indexes();
  for (const index of indexes) {
    if (index.unique && Object.keys(index.key).length === 1 && index.key.mobileNumber === 1) await users.dropIndex(index.name);
  }
  await users.createIndex({ mobileNumber: 1, mobileUniquenessScope: 1 }, { unique: true, name: 'mobileNumber_scope_unique' });
  console.log('Al-Shaab household mobile index migration completed.');
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
