const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceClaim = require('./models/InsuranceClaim');
const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function show() {
  try {
    await mongoose.connect(MONGO_URI);
    const claims = await InsuranceClaim.find()
      .populate('insuranceCompanyId', 'nameAr name _id')
      .sort({ createdAt: -1 });

    console.log(`Found ${claims.length} total claims\n`);
    
    // Group by company
    const byCompany = {};
    claims.forEach(claim => {
      const name = claim.insuranceCompanyId?.nameAr || claim.insuranceCompany;
      if (!byCompany[name]) {
        byCompany[name] = [];
      }
      byCompany[name].push({
        status: claim.status,
        createdAt: new Date(claim.createdAt).toLocaleDateString('en-US')
      });
    });

    Object.entries(byCompany).forEach(([company, items]) => {
      console.log(`${company}: ${items.length} claims`);
      items.forEach(item => {
        console.log(`  - ${item.status} (${item.createdAt})`);
      });
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

show();
