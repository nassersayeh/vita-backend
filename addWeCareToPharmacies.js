// Script to add WeCare (وي كير - البركة) to all pharmacies' insuranceCompanies array
// Run: node addWeCareToPharmacies.js

const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./models/User');
const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Find the WeCare company by username or email
    const company = await InsuranceCompany.findOne({ $or: [{ username: 'wecare' }, { email: 'wecare@vita.ps' }, { name: /WeCare|البركة/i }] });
    if (!company) {
      console.error('❌ WeCare company not found. Make sure it is seeded.');
      process.exit(1);
    }

    const label = company.nameAr ? `${company.nameAr} - ${company.name}` : company.name;

    // Update all pharmacies to include this label if not already present
    const result = await User.updateMany(
      { role: 'Pharmacy', $or: [ { insuranceCompanies: { $exists: false } }, { insuranceCompanies: { $nin: [label] } } ] },
      { $addToSet: { insuranceCompanies: label } }
    );

    console.log(`✅ Updated ${result.modifiedCount || result.nModified || 0} pharmacies to include: ${label}`);

    // Optionally show a sample pharmacy
    const sample = await User.findOne({ role: 'Pharmacy', insuranceCompanies: label }).select('fullName mobileNumber insuranceCompanies').lean();
    if (sample) {
      console.log('Sample updated pharmacy:', sample);
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

run();
