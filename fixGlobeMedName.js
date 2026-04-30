// Fix script to remove duplicate English name from nameAr field in insurance companies
const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

const fixes = [
  { email: 'nic@vita.ps', nameAr: 'شركة التأمين الوطنية' },
  { email: 'trust@vita.ps', nameAr: 'شركة ترست العالمية للتأمين' },
  { email: 'ahleia@vita.ps', nameAr: 'المجموعة الأهلية للتأمين' },
  { email: 'palmmedservice@vita.ps', nameAr: 'بال ميد سيرفيس' },
  { email: 'palestineins@vita.ps', nameAr: 'شركة فلسطين للتأمين' },
  { email: 'nathealth@vita.ps', nameAr: 'نات هيلث' },
  { email: 'globemed@vita.ps', nameAr: 'جلوب ميد فلسطين' },
];

async function fixNames() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    console.log('\n📋 Fixing Arabic names...\n');

    for (const fix of fixes) {
      const company = await InsuranceCompany.findOne({ email: fix.email });
      if (company) {
        const oldNameAr = company.nameAr;
        company.nameAr = fix.nameAr;
        await company.save();
        console.log(`  ✅ Fixed ${company.name}:`);
        console.log(`     Old: ${oldNameAr}`);
        console.log(`     New: ${company.nameAr}\n`);
      } else {
        console.log(`  ⚠️  Not found: ${fix.email}\n`);
      }
    }

    console.log('🎉 All names fixed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Fix failed:', error);
    process.exit(1);
  }
}

fixNames();
