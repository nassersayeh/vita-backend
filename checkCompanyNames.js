const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceCompany = require('./models/InsuranceCompany');

async function check() {
  try {
    await mongoose.connect('mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin');
    
    const companies = await InsuranceCompany.find();
    console.log('Current Insurance Companies:\n');
    
    companies.forEach(c => {
      const fullName = c.nameAr && c.name ? `${c.nameAr} - ${c.name}` : (c.nameAr || c.name);
      console.log(`Arabic: "${c.nameAr}"`);
      console.log(`English: "${c.name}"`);
      console.log(`Full Display: "${fullName}"`);
      console.log('---');
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

check();
