// Script: fixSpecialClaims.js
// Purpose: Fix claims with problematic company names or ids

const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceClaim = require('./models/InsuranceClaim');

async function run() {
  try {
    await mongoose.connect('mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin');
    // 1. Fix claims with insuranceCompany = "69edd36e52ba142bd244ba89"
    const emedId = '69edd36e52ba142bd244ba89';
    const emedName = 'اي ميد "تمكين" - E-Med "Tamkeen"';
    let updated = 0;
    let claims = await InsuranceClaim.find({ insuranceCompany: emedId });
    for (const claim of claims) {
      claim.insuranceCompany = emedName;
      claim.insuranceCompanyId = emedId;
      await claim.save();
      updated++;
      console.log(`✅ Updated claim ${claim._id} to E-Med "Tamkeen"`);
    }
    // 2. Fix claims with typo in GlobeMed Palestine
    const globeId = '69e4915a162e269f9818e9aa';
    const globeName = 'جلوب ميد فلسطين - GlobeMed Palestine - GlobeMed Palestine';
    claims = await InsuranceClaim.find({ insuranceCompany: { $regex: '^جلوب ميد فلسطين - GlobeMed Palestin$', $options: 'i' } });
    for (const claim of claims) {
      claim.insuranceCompany = globeName;
      claim.insuranceCompanyId = globeId;
      await claim.save();
      updated++;
      console.log(`✅ Updated claim ${claim._id} to GlobeMed Palestine`);
    }
    console.log(`\n✅ Updated ${updated} special claims.`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}
run();
