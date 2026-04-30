const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceClaim = require('./models/InsuranceClaim');
const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function fix() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const claims = await InsuranceClaim.find()
      .populate('insuranceCompanyId', 'nameAr name _id');

    console.log(`Found ${claims.length} total claims\n`);
    
    let updateCount = 0;

    for (const claim of claims) {
      const correctName = claim.insuranceCompanyId?.nameAr && claim.insuranceCompanyId?.name
        ? `${claim.insuranceCompanyId.nameAr} - ${claim.insuranceCompanyId.name}`
        : (claim.insuranceCompanyId?.nameAr || claim.insuranceCompanyId?.name);

      if (claim.insuranceCompany !== correctName) {
        console.log(`Updating claim ${claim._id}`);
        console.log(`  Old: "${claim.insuranceCompany}"`);
        console.log(`  New: "${correctName}"`);
        
        await InsuranceClaim.updateOne(
          { _id: claim._id },
          { insuranceCompany: correctName }
        );
        updateCount++;
      }
    }

    console.log(`\n✅ Updated ${updateCount} claims`);

    // Verify
    console.log('\n=== Verification ===\n');
    const updatedClaims = await InsuranceClaim.find()
      .populate('insuranceCompanyId', 'nameAr name _id');

    const byCompany = {};
    updatedClaims.forEach(claim => {
      const name = claim.insuranceCompany;
      if (!byCompany[name]) {
        byCompany[name] = { count: 0, pending: 0, under_review: 0, rejected: 0, paid: 0, draft: 0 };
      }
      byCompany[name].count++;
      byCompany[name][claim.status]++;
    });

    Object.entries(byCompany).forEach(([company, data]) => {
      console.log(`${company}`);
      console.log(`  Total: ${data.count}, Pending: ${data.pending}, Under Review: ${data.under_review}, Rejected: ${data.rejected}, Paid: ${data.paid}, Draft: ${data.draft}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fix();
