const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceCompany = require('./models/InsuranceCompany');

async function run() {
  try {
    await mongoose.connect('mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin');
    const companies = await InsuranceCompany.find({
      $or: [
        { nameAr: { $regex: 'جلوب', $options: 'i' } },
        { name: { $regex: 'GlobeMed', $options: 'i' } }
      ]
    });
    companies.forEach(company => {
      const fullName = company.nameAr && company.name ? `${company.nameAr} - ${company.name}` : (company.nameAr || company.name);
      console.log('ID:', company._id.toString());
      console.log('nameAr:', company.nameAr);
      console.log('name:', company.name);
      console.log('Full name:', fullName);
      console.log('---');
    });
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}
run();
