// Script to add WeCare "البركة" insurance company
// Run: node addWeCareBarkah.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function addWeCare() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const hashedPassword = await bcrypt.hash('123456789', 10);

    const companyData = {
      name: 'WeCare - Al Baraka',
      nameAr: 'وي كير - البركة',
      phone: '0599100016',
      email: 'wecare@vita.ps',
      username: 'wecare',
      password: hashedPassword,
      country: 'Palestine',
      coveragePercentage: 80,
      status: 'active',
    };

    const existing = await InsuranceCompany.findOne({
      $or: [{ username: 'wecare' }, { email: 'wecare@vita.ps' }]
    });

    if (existing) {
      existing.name = companyData.name;
      existing.nameAr = companyData.nameAr;
      existing.phone = companyData.phone;
      existing.status = 'active';
      await existing.save();
      console.log(`🔄 Updated: ${companyData.nameAr}`);
    } else {
      await InsuranceCompany.create(companyData);
      console.log(`✅ Created: ${companyData.nameAr} (WeCare - Al Baraka)`);
    }

    console.log('\n📝 Login Credentials:');
    console.log(`  وي كير - البركة: mobile=${companyData.phone}, password=123456789`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Failed:', error);
    process.exit(1);
  }
}

addWeCare();
