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
      .populate('insuranceCompanyId', 'nameAr name _id')
      .sort({ createdAt: -1 });

    console.log('=== All Claims (Most Recent First) ===\n');
    claims.forEach((claim, i) => {
      console.log(`${i+1}. Created: ${new Date(claim.createdAt).toLocaleString()}`);
      console.log(`   Status: ${claim.status}`);
      console.log(`   Stored Name: "${claim.insuranceCompany}"`);
      console.log(`   DB Name (Arabic): "${claim.insuranceCompanyId?.nameAr}"`);
      console.log(`   DB ID: ${claim.insuranceCompanyId?._id || 'MISSING'}`);
      console.log('');
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

analyze();
