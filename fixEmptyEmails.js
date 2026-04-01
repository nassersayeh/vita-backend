// Script to fix empty email values in the database
// Run with: node fixEmptyEmails.js

const mongoose = require('mongoose');

async function fixEmptyEmails() {
  try {
    await mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.rsdkh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');

    // Step 1: Drop the problematic email index first
    console.log('Step 1: Dropping existing email index...');
    try {
      await usersCollection.dropIndex('email_1');
      console.log('Dropped email_1 index');
    } catch (e) {
      console.log('No email_1 index to drop or error:', e.message);
    }

    // Step 2: Drop username index if exists
    try {
      await usersCollection.dropIndex('username_1');
      console.log('Dropped username_1 index');
    } catch (e) {
      console.log('No username_1 index to drop or error:', e.message);
    }

    // Step 3: Update empty emails to remove the field
    console.log('Step 2: Fixing empty email fields...');
    const emailResult = await usersCollection.updateMany(
      { $or: [{ email: '' }, { email: null }] },
      { $unset: { email: 1 } }
    );
    console.log(`Updated ${emailResult.modifiedCount} users - removed empty/null email fields`);

    // Step 4: Update empty usernames to remove the field
    console.log('Step 3: Fixing empty username fields...');
    const usernameResult = await usersCollection.updateMany(
      { $or: [{ username: '' }, { username: null }] },
      { $unset: { username: 1 } }
    );
    console.log(`Updated ${usernameResult.modifiedCount} users - removed empty/null username fields`);

    // Step 5: Recreate the indexes with sparse: true
    console.log('Step 4: Recreating sparse unique indexes...');
    await usersCollection.createIndex(
      { email: 1 },
      { unique: true, sparse: true }
    );
    console.log('Created email index with sparse: true');

    await usersCollection.createIndex(
      { username: 1 },
      { unique: true, sparse: true }
    );
    console.log('Created username index with sparse: true');

    console.log('Done! Database fixed successfully.');

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixEmptyEmails();
