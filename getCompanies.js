const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function get() {
  try {
    await mongoose.connect(MONGO_URI);
    const companies = await InsuranceCompany.find().sort({ createdAt: 1 });
    console.log('ID | English Name | Arabic Name');
    console.log('---|---|---');
    companies.forEach(c => {
      console.log(`${c._id} | ${c.name} | ${c.nameAr}`);
    });
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

get();
