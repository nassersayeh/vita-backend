const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceClaim = require('./models/InsuranceClaim');
const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function check() {
  try {
    await mongoose.connect('mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin');
    const companies = await InsuranceCompany.find();
    const companyMap = {};
    companies.forEach(c => {
      const fullName = c.nameAr && c.name ? `${c.nameAr} - ${c.name}` : (c.nameAr || c.name);
      companyMap[c._id.toString()] = fullName;
    });
    console.log('=== Insurance Companies in DB ===');
    Object.entries(companyMap).forEach(([id, name]) => {
      console.log(`ID: ${id} | Name: "${name}"`);
    });
    const claims = await InsuranceClaim.find();
    const claimMap = {};
    claims.forEach(claim => {
      const id = claim.insuranceCompanyId ? claim.insuranceCompanyId.toString() : 'null';
      const name = claim.insuranceCompany;
      if (!claimMap[id]) claimMap[id] = {};
      if (!claimMap[id][name]) claimMap[id][name] = 0;
      claimMap[id][name]++;
    });
    console.log('\n=== Claims Grouped by insuranceCompanyId and Name ===');
    Object.entries(claimMap).forEach(([id, names]) => {
      Object.entries(names).forEach(([name, count]) => {
        console.log(`ID: ${id} | Name: "${name}" | Claims: ${count}`);
      });
    });
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

check();
