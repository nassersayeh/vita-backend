const mongoose = require('mongoose');

async function check() {
  await mongoose.connect('mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net');
  
  const User = require('../models/User');
  
  // Get ALL users with role "User" (these are the "deleted" patients)
  const users = await User.find({ role: 'User' }).lean();
  
  console.log('=== المرضى "المحذوفين" (role=User) ===');
  console.log('Total:', users.length);
  for (const u of users) {
    console.log(`  ID: ${u._id} | Name: ${u.name} | Phone: ${u.mobileNumber} | Email: ${u.email}`);
    // Print ALL fields to see what data exists
    const keys = Object.keys(u).filter(k => !['__v', '_id', 'password'].includes(k));
    for (const k of keys) {
      const val = u[k];
      if (val !== undefined && val !== null && val !== '') {
        if (typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
          console.log(`    ${k}: ${JSON.stringify(val)}`);
        } else if (Array.isArray(val) && val.length > 0) {
          console.log(`    ${k}: [${val.length} items]`);
        } else if (!Array.isArray(val)) {
          console.log(`    ${k}: ${val}`);
        }
      }
    }
    console.log('---');
  }

  // Also check the one that's DELETED (no User doc)
  console.log('\n=== IDs محذوفة تماماً (لا يوجد User document) ===');
  console.log('69ce3a4a6ae5750e29c53522 - was likely a test patient (evaluation appointment with د. علاء)');
  console.log('69ce7f6d49893bf019b5cc2a - was likely a test patient (had lab tests)');

  await mongoose.disconnect();
}

check().catch(console.error);
