// Seed script for pharmacy insurance companies and union account
// Run: node seedPharmacyInsurance.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const InsuranceCompany = require('./models/InsuranceCompany');
const OversightAccount = require('./models/OversightAccount');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

const insuranceCompanies = [
  { name: 'NIC', nameAr: 'شركة التأمين الوطنية - NIC', phone: '0599100001', email: 'nic@vita.ps', username: 'nic' },
  { name: 'Trust', nameAr: 'شركة ترست العالمية للتأمين - Trust', phone: '0599100002', email: 'trust@vita.ps', username: 'trust' },
  { name: 'AHLEIA', nameAr: 'المجموعة الأهلية للتأمين - AHLEIA', phone: '0599100003', email: 'ahleia@vita.ps', username: 'ahleia' },
  { name: 'Al Mashreq', nameAr: 'شركة المشرق للتأمين - Al Mashreq', phone: '0599100004', email: 'almashreq@vita.ps', username: 'almashreq' },
  { name: 'Palestine Insurance', nameAr: 'شركة فلسطين للتأمين - Palestine Insurance', phone: '0599100005', email: 'palestineins@vita.ps', username: 'palestineins' },
  { name: 'Takaful', nameAr: 'التكافل الفلسطيني للتأمين - Takaful', phone: '0599100006', email: 'takaful@vita.ps', username: 'takaful' },
  { name: 'Al Etilaf', nameAr: 'شركة الائتلاف للتأمين - Al Etilaf', phone: '0599100007', email: 'aletilaf@vita.ps', username: 'aletilaf' },
  { name: 'Global United', nameAr: 'شركة جلوبال المتحدة للتأمين - Global United', phone: '0599100008', email: 'globalunited@vita.ps', username: 'globalunited' },
  { name: 'NatHealth', nameAr: 'نات هيلث - NatHealth', phone: '0599100009', email: 'nathealth@vita.ps', username: 'nathealth' },
  { name: 'GlobeMed Palestine', nameAr: 'جلوب ميد فلسطين - GlobeMed Palestine', phone: '0599100010', email: 'globemed@vita.ps', username: 'globemed' },
  { name: 'MedNet', nameAr: 'ميد نت - MedNet', phone: '0599100011', email: 'mednet@vita.ps', username: 'mednet' },
  { name: 'NextCare', nameAr: 'نيكست كير - NextCare', phone: '0599100012', email: 'nextcare@vita.ps', username: 'nextcare' },
  { name: 'MedCare', nameAr: 'شركة ميد كير - MedCare', phone: '0599100013', email: 'medcare@vita.ps', username: 'medcare' },
  { name: 'Mithaq', nameAr: 'شركة ميثاق للتأمين - Mithaq', phone: '0599100014', email: 'mithaq@vita.ps', username: 'mithaq' },
  { name: 'AIC', nameAr: 'شركة التأمين العربية - AIC', phone: '0599100015', email: 'aic@vita.ps', username: 'aic' },
];

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const hashedPassword = await bcrypt.hash('123456789', 10);

    // ==================== INSURANCE COMPANIES ====================
    console.log('\n📋 Seeding Insurance Companies...');
    
    for (const company of insuranceCompanies) {
      const existing = await InsuranceCompany.findOne({ $or: [{ phone: company.phone }, { email: company.email }] });
      if (existing) {
        // Update existing
        existing.name = company.name;
        existing.nameAr = company.nameAr;
        existing.phone = company.phone;
        existing.username = company.username;
        existing.password = hashedPassword;
        existing.status = 'active';
        await existing.save();
        console.log(`  🔄 Updated: ${company.nameAr} - mobile: ${company.phone}`);
      } else {
        await InsuranceCompany.create({
          ...company,
          password: hashedPassword,
          country: 'Palestine',
          coveragePercentage: 80,
          status: 'active',
        });
        console.log(`  ✅ Created: ${company.nameAr} - mobile: ${company.phone}`);
      }
    }

    // ==================== PHARMACY UNION (Oversight) ====================
    console.log('\n🏛️  Seeding Pharmacy Union Account...');
    
    const unionData = {
      name: 'Pharmacist Union',
      nameAr: 'نقابة الصيادلة',
      type: 'pharmacy_syndicate',
      email: 'pharmsyndicate@vita.ps',
      phone: '0599200001',
      username: 'pharm_syndicate',
    };

    const existingUnion = await OversightAccount.findOne({ type: 'pharmacy_syndicate' });
    if (existingUnion) {
      existingUnion.phone = unionData.phone;
      existingUnion.password = hashedPassword;
      existingUnion.status = 'active';
      await existingUnion.save();
      console.log(`  🔄 Updated: ${unionData.nameAr} - mobile: ${unionData.phone}`);
    } else {
      await OversightAccount.create({
        ...unionData,
        password: hashedPassword,
        canViewDoctorClaims: true,
        canViewPharmacyClaims: true,
        canViewFinancials: true,
        status: 'active',
      });
      console.log(`  ✅ Created: ${unionData.nameAr} - mobile: ${unionData.phone}`);
    }

    console.log('\n🎉 Seeding complete!');
    console.log('\n📝 Login Credentials (all use password: 123456789):');
    console.log('─────────────────────────────────────');
    console.log('Insurance Companies (/insurance-claims):');
    insuranceCompanies.forEach(c => {
      console.log(`  ${c.nameAr}: mobile=${c.phone}`);
    });
    console.log('\nPharmacist Union (/pharmacist-union):');
    console.log(`  نقابة الصيادلة: mobile=0599200001`);
    console.log('─────────────────────────────────────');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seed();
