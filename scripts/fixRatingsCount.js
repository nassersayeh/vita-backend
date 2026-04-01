// Script to update all users to have ratingsCount: 0 if not present
const mongoose = require('mongoose');
const User = require('../models/User');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/vita'; // Update if needed

async function updateRatingsCount() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const result = await User.updateMany(
    { ratingsCount: { $exists: false } },
    { $set: { ratingsCount: 0 } }
  );
  console.log('Users updated:', result.modifiedCount);
  await mongoose.disconnect();
}

updateRatingsCount().catch(err => {
  console.error(err);
  process.exit(1);
});
