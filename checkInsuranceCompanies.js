const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceCompany = require('./models/InsuranceCompany');
const InsuranceClaim = require('./models/InsuranceClaim');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function check() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all insurance companies
    console.log('=== جميع شركات التأمين المسجلة ===\n');
    const companies = await InsuranceCompany.find().sort({ createdAt: 1 });
    companies.forEach((c, i) => {
      console.log(`${i+1}. ID: ${c._id}`);
      console.log(`   الاسم الإنجليزي: ${c.name}`);
      console.log(`   الاسم العربي: ${c.nameAr}`);
      console.log(`   البريد: ${c.email}`);
      console.log('');
    });

    // Get all claims and group by insurance company
    console.log('\n=== جميع المطالبات المجمعة حسب شركة التأمين ===\n');
    const claims = await InsuranceClaim.find()
      .populate('insuranceCompanyId', 'nameAr name _id');
    
    const claimsByCompany = {};
    claims.forEach(claim => {
      const companyName = claim.insuranceCompanyId?.nameAr || claim.insuranceCompanyId?.name || claim.insuranceCompany;
      if (!claimsByCompany[companyName]) {
        claimsByCompany[companyName] = {
          count: 0,
          total: 0,
          pending: 0,
          paid: 0,
          rejected: 0,
          draft: 0
        };
      }
      claimsByCompany[companyName].count++;
      claimsByCompany[companyName].total += claim.claimsValue || 0;
      if (claim.status === 'pending') claimsByCompany[companyName].pending++;
      else if (claim.status === 'paid') claimsByCompany[companyName].paid++;
      else if (claim.status === 'rejected') claimsByCompany[companyName].rejected++;
      else if (claim.status === 'draft') claimsByCompany[companyName].draft++;
    });

    Object.entries(claimsByCompany).forEach(([name, data], i) => {
      console.log(`${i+1}. ${name}`);
      console.log(`   العدد الكلي: ${data.count}`);
      console.log(`   المجموع: ${data.total}`);
      console.log(`   معلقة: ${data.pending}, مدفوعة: ${data.paid}, مرفوضة: ${data.rejected}, مسودة: ${data.draft}`);
      console.log('');
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

check();
