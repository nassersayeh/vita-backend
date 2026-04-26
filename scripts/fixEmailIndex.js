const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27017/vita?authSource=admin';

async function run() {
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  // Check current email index
  const indexes = await db.collection('users').indexes();
  const emailIdx = indexes.find(i => i.key && i.key.email);
  console.log('Current email index:', JSON.stringify(emailIdx));

  // Drop and recreate with sparse if needed
  if (emailIdx && !emailIdx.sparse) {
    console.log('Dropping non-sparse email index...');
    await db.collection('users').dropIndex('email_1');
    await db.collection('users').createIndex({ email: 1 }, { unique: true, sparse: true });
    console.log('✅ Recreated email index with sparse: true');
  } else {
    console.log('✅ Index already sparse — no change needed');
  }

  // Fix existing docs with empty string email
  const result = await db.collection('users').updateMany(
    { email: '' },
    { $unset: { email: '' } }
  );
  console.log(`✅ Fixed ${result.modifiedCount} docs with empty email string`);

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
