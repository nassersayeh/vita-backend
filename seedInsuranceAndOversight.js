// Seed script for insurance companies and oversight accounts
// Run: node seedInsuranceAndOversight.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const InsuranceCompany = require('./models/InsuranceCompany');
const OversightAccount = require('./models/OversightAccount');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/vita';

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // ==================== INSURANCE COMPANIES ====================
    console.log('\n📋 Seeding Insurance Companies...');
    
    const insuranceCompanies = [
      {
        name: 'NatHealth',
        nameAr: 'نات هيلث',
        email: 'info@nathealth.com',
        phone: '0599000001',
        username: 'nathealth',
        password: '123456789',
        coveragePercentage: 80,
        address: 'Ramallah, Palestine',
        city: 'Ramallah',
        country: 'Palestine',
        contactPerson: 'Ahmad Hassan',
        status: 'active'
      },
      {
        name: 'GlobeMed',
        nameAr: 'جلوب ميد',
        email: 'info@globemed.com',
        phone: '0599000002',
        username: 'globemed',
        password: '123456789',
        coveragePercentage: 75,
        address: 'Nablus, Palestine',
        city: 'Nablus',
        country: 'Palestine',
        contactPerson: 'Sara Khalil',
        status: 'active'
      },
      {
        name: 'MedCare',
        nameAr: 'ميد كير',
        email: 'info@medcare.com',
        phone: '0599000003',
        username: 'medcare',
        password: '123456789',
        coveragePercentage: 85,
        address: 'Hebron, Palestine',
        city: 'Hebron',
        country: 'Palestine',
        contactPerson: 'Mohammed Ali',
        status: 'active'
      }
    ];

    for (const company of insuranceCompanies) {
      const existing = await InsuranceCompany.findOne({ email: company.email });
      if (existing) {
        console.log(`  ⚠️  ${company.name} already exists, skipping`);
        continue;
      }
      
      const hashedPassword = await bcrypt.hash(company.password, 10);
      await InsuranceCompany.create({
        ...company,
        password: hashedPassword
      });
      console.log(`  ✅ Created: ${company.name} (${company.nameAr}) - username: ${company.username}, password: ${company.password}`);
    }

    // ==================== OVERSIGHT ACCOUNTS ====================
    console.log('\n🏛️  Seeding Oversight Accounts...');
    
    const oversightAccounts = [
      {
        name: 'Ministry of Health',
        nameAr: 'وزارة الصحة',
        type: 'ministry_of_health',
        email: 'oversight@moh.gov',
        phone: '0599100001',
        username: 'moh_oversight',
        password: '123456789',
        canViewDoctorClaims: true,
        canViewPharmacyClaims: true,
        canViewFinancials: true,
        status: 'active'
      },
      {
        name: 'Medical Syndicate',
        nameAr: 'نقابة الأطباء',
        type: 'medical_syndicate',
        email: 'oversight@medsyndicate.org',
        phone: '0599100002',
        username: 'med_syndicate',
        password: '123456789',
        canViewDoctorClaims: true,
        canViewPharmacyClaims: true,
        canViewFinancials: true,
        status: 'active'
      },
      {
        name: 'Pharmacy Syndicate',
        nameAr: 'نقابة الصيادلة',
        type: 'pharmacy_syndicate',
        email: 'oversight@pharmsyndicate.org',
        phone: '0599100003',
        username: 'pharm_syndicate',
        password: '123456789',
        canViewDoctorClaims: true,
        canViewPharmacyClaims: true,
        canViewFinancials: true,
        status: 'active'
      }
    ];

    for (const account of oversightAccounts) {
      const existing = await OversightAccount.findOne({ type: account.type });
      if (existing) {
        console.log(`  ⚠️  ${account.nameAr} already exists, skipping`);
        continue;
      }
      
      const hashedPassword = await bcrypt.hash(account.password, 10);
      await OversightAccount.create({
        ...account,
        password: hashedPassword
      });
      console.log(`  ✅ Created: ${account.nameAr} (${account.name}) - username: ${account.username}, password: ${account.password}`);
    }

    console.log('\n🎉 Seeding complete!');
    console.log('\n📝 Login Credentials:');
    console.log('─────────────────────────────────────');
    console.log('Insurance Companies:');
    insuranceCompanies.forEach(c => {
      console.log(`  ${c.nameAr} (${c.name}): username=${c.username}, password=${c.password}`);
    });
    console.log('\nOversight Accounts:');
    oversightAccounts.forEach(a => {
      console.log(`  ${a.nameAr} (${a.name}): username=${a.username}, password=${a.password}`);
    });
    console.log('─────────────────────────────────────');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seed();
