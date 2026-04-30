const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceClaim = require('./models/InsuranceClaim');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function check() {
  try {
    await mongoose.connect(MONGO_URI);
    const claims = await InsuranceClaim.find();
    
    console.log('Stored Company Names in Claims:\n');
    claims.forEach(claim => {
      console.log(`Claim ID: ${claim._id}`);
      console.log(`  Stored Name: "${claim.insuranceCompany}"`);
      console.log(`  Company ID: ${claim.insuranceCompanyId}`);
      console.log('');
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

check();
