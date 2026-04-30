const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceCompany = require('./models/InsuranceCompany');
const InsuranceClaim = require('./models/InsuranceClaim');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function test() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB\n');
    
    // Find GlobeMed company
    const company = await InsuranceCompany.findOne({ 
      nameAr: { $regex: 'جلوب', $options: 'i' }
    });
    
    if (!company) {
      console.log('❌ GlobeMed company not found');
      process.exit(1);
    }
    
    console.log('✅ Found GlobeMed company:');
    console.log(`   Arabic: ${company.nameAr}`);
    console.log(`   English: ${company.name}`);
    console.log(`   ID: ${company._id}\n`);
    
    // Simulate what the API should save
    const fullCompanyName = company.nameAr && company.name 
      ? `${company.nameAr} - ${company.name}` 
      : (company.nameAr || company.name);
    
    console.log('✅ Full Company Name to be saved:');
    console.log(`   "${fullCompanyName}"\n`);
    
    // Check current claims for this company
    const claims = await InsuranceClaim.find({ insuranceCompanyId: company._id });
    
    console.log(`✅ Current claims for this company: ${claims.length}`);
    claims.forEach((claim, i) => {
      console.log(`   ${i + 1}. Status: ${claim.status}, Stored Name: "${claim.insuranceCompany}"`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

test();
