// Script: fixAllClaimCompanyNames.js
// Purpose: Update all InsuranceClaim documents to use the unified company name (Arabic - English) from InsuranceCompany

const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceClaim = require('./models/InsuranceClaim');
const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function run() {
  try {
    await mongoose.connect('mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin');
    console.log('Connected to MongoDB');

    const companies = await InsuranceCompany.find();
    const companyMap = {};
    companies.forEach(c => {
      const fullName = c.nameAr && c.name ? `${c.nameAr} - ${c.name}` : (c.nameAr || c.name);
      companyMap[c._id.toString()] = fullName;
    });

    const claims = await InsuranceClaim.find();
    let updated = 0;
    for (const claim of claims) {
      const cid = claim.insuranceCompanyId?.toString();
      if (cid && companyMap[cid] && claim.insuranceCompany !== companyMap[cid]) {
        claim.insuranceCompany = companyMap[cid];
        await claim.save();
        updated++;
        console.log(`Updated claim ${claim._id}: ${companyMap[cid]}`);
      }
    }
    console.log(`\n✅ Updated ${updated} claims to use unified company names.`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

run();
