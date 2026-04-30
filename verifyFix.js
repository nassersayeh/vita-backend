const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceClaim = require('./models/InsuranceClaim');
const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function verify() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const claims = await InsuranceClaim.find()
      .populate('insuranceCompanyId', 'nameAr name _id');

    console.log('=== All Claims with Insurance Company Linking ===\n');
    claims.forEach((claim, i) => {
      console.log(`${i+1}. Claim ID: ${claim._id}`);
      console.log(`   Status: ${claim.status}`);
      console.log(`   Insurance Company ID: ${claim.insuranceCompanyId?._id || 'MISSING'}`);
      console.log(`   Company Name (Arabic): ${claim.insuranceCompanyId?.nameAr || claim.insuranceCompany}`);
      console.log(`   Stored String: "${claim.insuranceCompany}"`);
      console.log('');
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

verify();
