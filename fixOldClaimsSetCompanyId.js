// Script: fixOldClaimsSetCompanyId.js
// Purpose: Update all old InsuranceClaims to set insuranceCompanyId based on the company name

const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceClaim = require('./models/InsuranceClaim');
const InsuranceCompany = require('./models/InsuranceCompany');

async function run() {
  try {
    await mongoose.connect('mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin');
    const companies = await InsuranceCompany.find();
    // Build a map: normalized name => id
    const companyMap = {};
    companies.forEach(c => {
      const fullName = c.nameAr && c.name ? `${c.nameAr} - ${c.name}` : (c.nameAr || c.name);
      companyMap[fullName.trim()] = c._id;
    });
    const claims = await InsuranceClaim.find({ $or: [ { insuranceCompanyId: null }, { insuranceCompanyId: { $exists: false } } ] });
    let updated = 0;
    for (const claim of claims) {
      const name = (claim.insuranceCompany || '').trim();
      const companyId = companyMap[name];
      if (companyId) {
        claim.insuranceCompanyId = companyId;
        await claim.save();
        updated++;
        console.log(`✅ Updated claim ${claim._id} with companyId ${companyId}`);
      } else {
        console.log(`❌ No match for claim ${claim._id} with name: "${name}"`);
      }
    }
    console.log(`\n✅ Updated ${updated} claims with correct insuranceCompanyId.`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

run();
