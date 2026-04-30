const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceClaim = require('./models/InsuranceClaim');
const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function analyze() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const claims = await InsuranceClaim.find()
      .populate('insuranceCompanyId', 'nameAr name _id');
    const companies = await InsuranceCompany.find();

    console.log('=== Company Names Analysis ===\n');
    console.log('Companies in Database:');
    companies.forEach((c, i) => {
      console.log(`${i+1}. ID: ${c._id}`);
      console.log(`   English: "${c.name}"`);
      console.log(`   Arabic: "${c.nameAr}"`);
    });

    console.log('\n\n=== Claims with Different Names ===\n');
    
    // Group claims by company ID to see all names used
    const claimsById = {};
    claims.forEach(claim => {
      const id = claim.insuranceCompanyId?._id?.toString();
      if (!claimsById[id]) {
        claimsById[id] = {
          nameAr: claim.insuranceCompanyId?.nameAr,
          name: claim.insuranceCompanyId?.name,
          storedNames: new Set()
        };
      }
      claimsById[id].storedNames.add(claim.insuranceCompany);
    });

    Object.entries(claimsById).forEach(([id, data]) => {
      if (data.storedNames.size > 1) {
        console.log(`⚠️  Company ID: ${id}`);
        console.log(`   Database Arabic: "${data.nameAr}"`);
        console.log(`   Database English: "${data.name}"`);
        console.log(`   Stored Names in Claims:`);
        data.storedNames.forEach(name => {
          console.log(`     - "${name}"`);
        });
        console.log('');
      }
    });

    console.log('\n=== All Unique Names Stored in Claims ===\n');
    const uniqueNames = new Set(claims.map(c => c.insuranceCompany));
    const nameToIds = {};
    
    claims.forEach(claim => {
      const name = claim.insuranceCompany;
      const id = claim.insuranceCompanyId?._id?.toString();
      if (!nameToIds[name]) {
        nameToIds[name] = new Set();
      }
      nameToIds[name].add(id);
    });

    Object.entries(nameToIds).forEach(([name, ids]) => {
      console.log(`"${name}"`);
      console.log(`  Count: ${claims.filter(c => c.insuranceCompany === name).length}`);
      console.log(`  Company IDs: ${Array.from(ids).join(', ')}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

analyze();
