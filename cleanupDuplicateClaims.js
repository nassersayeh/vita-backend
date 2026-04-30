const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceClaim = require('./models/InsuranceClaim');
const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function cleanup() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all claims
    const claims = await InsuranceClaim.find()
      .populate('insuranceCompanyId', 'nameAr name _id');

    // Group claims by company ID and collect all stored names
    const claimsByCompanyId = {};
    claims.forEach(claim => {
      const companyId = claim.insuranceCompanyId?._id?.toString();
      if (!claimsByCompanyId[companyId]) {
        claimsByCompanyId[companyId] = {
          nameAr: claim.insuranceCompanyId?.nameAr,
          name: claim.insuranceCompanyId?.name,
          storedNames: new Set(),
          claims: []
        };
      }
      claimsByCompanyId[companyId].storedNames.add(claim.insuranceCompany);
      claimsByCompanyId[companyId].claims.push({
        _id: claim._id,
        insuranceCompany: claim.insuranceCompany,
        status: claim.status
      });
    });

    console.log('=== Analysis of Duplicate Names ===\n');
    
    let updateCount = 0;
    for (const [companyId, data] of Object.entries(claimsByCompanyId)) {
      if (data.storedNames.size > 1) {
        console.log(`⚠️  Company: ${data.nameAr} (${data.name})`);
        console.log(`   Company ID: ${companyId}`);
        console.log(`   Found ${data.storedNames.size} different names stored in claims:`);
        
        for (const name of data.storedNames) {
          const count = data.claims.filter(c => c.insuranceCompany === name).length;
          console.log(`     - "${name}" (${count} claims)`);
        }
        
        // Update all claims to use the correct name
        const correctName = data.nameAr;
        for (const claim of data.claims) {
          if (claim.insuranceCompany !== correctName) {
            console.log(`   Updating claim ${claim._id}: "${claim.insuranceCompany}" → "${correctName}"`);
            await InsuranceClaim.updateOne(
              { _id: claim._id },
              { insuranceCompany: correctName }
            );
            updateCount++;
          }
        }
        console.log('');
      }
    }

    console.log(`\n✅ Updated ${updateCount} claims with correct company names`);

    // Verify the cleanup
    console.log('\n=== Verification ===\n');
    const verifyClaimsById = {};
    const updatedClaims = await InsuranceClaim.find()
      .populate('insuranceCompanyId', 'nameAr name _id');
    
    updatedClaims.forEach(claim => {
      const companyId = claim.insuranceCompanyId?._id?.toString();
      if (!verifyClaimsById[companyId]) {
        verifyClaimsById[companyId] = {
          nameAr: claim.insuranceCompanyId?.nameAr,
          names: new Set()
        };
      }
      verifyClaimsById[companyId].names.add(claim.insuranceCompany);
    });

    for (const [companyId, data] of Object.entries(verifyClaimsById)) {
      if (data.names.size === 1) {
        const name = Array.from(data.names)[0];
        if (name === data.nameAr) {
          console.log(`✅ ${data.nameAr} - OK`);
        }
      } else {
        console.log(`❌ ${data.nameAr} - Still has ${data.names.size} different names!`);
        data.names.forEach(name => console.log(`     "${name}"`));
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

cleanup();
