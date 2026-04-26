// ensureWeCare.js
// Connects to MongoDB, lists existing insurance companies, and creates WeCare if missing.
// Usage: node ensureWeCare.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27017/vita?authSource=admin';

async function listCompanies() {
  const companies = await InsuranceCompany.find({}).sort({ createdAt: -1 });
  console.log('\n📄 Existing insurance companies (count=' + companies.length + '):');
  companies.forEach(c => {
    console.log(`- ${c._id} | ${c.nameAr || c.name} | email=${c.email || '-'} | phone=${c.phone || '-'} | username=${c.username || '-'} | status=${c.status || '-'} `);
  });
  return companies;
}

async function ensureWeCare() {
  try {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('✅ Connected to MongoDB');

    const companies = await listCompanies();

    // Try to find WeCare by username/email/name (flexible)
    const found = await InsuranceCompany.findOne({
      $or: [
        { username: 'wecare' },
        { email: 'wecare@vita.ps' },
        { name: { $regex: 'wecare|البركة', $options: 'i' } },
        { nameAr: { $regex: 'وي كير|البركة', $options: 'i' } },
      ]
    });

    if (found) {
      console.log('\nℹ️ WeCare already exists:');
      console.log(`  _id: ${found._id}`);
      console.log(`  name: ${found.nameAr || found.name}`);
      console.log(`  email: ${found.email || '-'}, phone: ${found.phone || '-'}, username: ${found.username || '-'}, status: ${found.status}`);
    } else {
      console.log('\n⚠️ WeCare not found — creating...');
      const hashed = await bcrypt.hash('123456789', 10);
      const newCompany = new InsuranceCompany({
        name: 'WeCare - Al Baraka',
        nameAr: 'وي كير - البركة',
        phone: '0599100016',
        email: 'wecare@vita.ps',
        username: 'wecare',
        password: hashed,
        country: 'Palestine',
        coveragePercentage: 80,
        maxCoverageAmount: 0,
        status: 'active',
      });
      await newCompany.save();
      console.log('✅ Created WeCare: ', newCompany._id);
    }

    console.log('\n🔁 Final list after ensure:');
    await listCompanies();

    await mongoose.disconnect();
    console.log('\nDone.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    try { await mongoose.disconnect(); } catch(e){}
    process.exit(1);
  }
}

ensureWeCare();
