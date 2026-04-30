const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceCompany = require('./models/InsuranceCompany');
const InsuranceClaim = require('./models/InsuranceClaim');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function verify() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB\n');
    
    // Get all insurance companies
    const companies = await InsuranceCompany.find().limit(5);
    
    console.log('=== Insurance Companies in Database ===');
    companies.forEach((c, i) => {
      console.log(`${i + 1}. ${c.nameAr} (${c.name})`);
      const fullName = c.nameAr && c.name ? `${c.nameAr} - ${c.name}` : (c.nameAr || c.name);
      console.log(`   Full display name: "${fullName}"`);
      console.log(`   ID: ${c._id}\n`);
    });
    
    // Get claims and verify they have correct format
    const claims = await InsuranceClaim.find().populate('insuranceCompanyId');
    
    console.log('\n=== Insurance Claims in Database ===');
    console.log(`Total claims: ${claims.length}\n`);
    
    const claimsByCompany = {};
    claims.forEach(claim => {
      const key = claim.insuranceCompany;
      if (!claimsByCompany[key]) {
        claimsByCompany[key] = [];
      }
      claimsByCompany[key].push({
        id: claim._id,
        status: claim.status,
        companyId: claim.insuranceCompanyId?._id || claim.insuranceCompanyId
      });
    });
    
    Object.entries(claimsByCompany).forEach(([companyName, claimsArray]) => {
      console.log(`Company: "${companyName}"`);
      console.log(`  Total claims: ${claimsArray.length}`);
      const statusCounts = {};
      claimsArray.forEach(claim => {
        statusCounts[claim.status] = (statusCounts[claim.status] || 0) + 1;
      });
      Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`    - ${status}: ${count}`);
      });
      console.log('');
    });
    
    // Verify proper format
    const correctFormat = claims.every(claim => {
      return claim.insuranceCompany && claim.insuranceCompany.includes(' - ');
    });
    
    console.log(`\n✅ All claims have correct format (Arabic - English): ${correctFormat ? 'YES ✓' : 'NO ✗'}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

verify();
