const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceClaim = require('./models/InsuranceClaim');
const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function update() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Map old names to new names
    const nameMapping = {
      'جلوب ميد فلسطين': 'جلوب ميد فلسطين - GlobeMed Palestine',
      'جلوب ميد فلسطين - GlobeMed Palestine': 'جلوب ميد فلسطين - GlobeMed Palestine',
    };

    console.log('Updating claims with old names...\n');
    
    for (const [oldName, newName] of Object.entries(nameMapping)) {
      if (oldName === newName) continue; // Skip if same
      
      const result = await InsuranceClaim.updateMany(
        { insuranceCompany: oldName },
        { insuranceCompany: newName }
      );
      
      if (result.modifiedCount > 0) {
        console.log(`✅ Updated ${result.modifiedCount} claims:`);
        console.log(`   "${oldName}" → "${newName}"\n`);
      }
    }

    // Verify
    console.log('=== Final Names in Database ===\n');
    const uniqueNames = await InsuranceClaim.distinct('insuranceCompany');
    const byName = {};

    for (const name of uniqueNames) {
      const count = await InsuranceClaim.countDocuments({ insuranceCompany: name });
      byName[name] = count;
    }

    Object.entries(byName)
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, count]) => {
        console.log(`${name}: ${count} claims`);
      });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

update();
