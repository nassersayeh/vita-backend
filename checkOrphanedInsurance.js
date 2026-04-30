// Check for orphaned insurance company references
const mongoose = require('mongoose');
require('dotenv').config();
const Claim = require('./models/Claim');
const DoctorClaim = require('./models/DoctorClaim');
const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function checkOrphaned() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Get all unique insuranceCompanyIds from claims
    const pharmacyCompanyIds = await Claim.distinct('insuranceCompanyId');
    const doctorCompanyIds = await DoctorClaim.distinct('insuranceCompanyId');
    
    const allIds = [...new Set([...pharmacyCompanyIds, ...doctorCompanyIds].filter(id => id))];
    
    console.log(`\nTotal unique insurance company IDs in claims: ${allIds.length}`);
    
    // Check which ones don't exist
    const validCompanies = await InsuranceCompany.find({ _id: { $in: allIds } }).select('_id');
    const validIds = new Set(validCompanies.map(c => c._id.toString()));
    
    const orphanedIds = allIds.filter(id => !validIds.has(id?.toString()));
    
    if (orphanedIds.length > 0) {
      console.log(`\n⚠️  Found ${orphanedIds.length} orphaned insurance company IDs:`);
      orphanedIds.forEach(id => console.log(`  - ${id}`));
      
      // Count claims for each orphaned ID
      console.log('\nClaims per orphaned ID:');
      for (const id of orphanedIds) {
        const pharmacyClaims = await Claim.countDocuments({ insuranceCompanyId: id });
        const doctorClaims = await DoctorClaim.countDocuments({ insuranceCompanyId: id });
        console.log(`  ${id}: ${pharmacyClaims} pharmacy + ${doctorClaims} doctor = ${pharmacyClaims + doctorClaims} total`);
      }
    } else {
      console.log('✅ No orphaned insurance company IDs found!');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkOrphaned();
