// findWhereDataStored.js
const mongoose = require('mongoose');
const Financial = require('./models/Financial');
const PharmacyFinancial = require('./models/PharmacyFinancial');
const User = require('./models/User');

const MONGODB_URI = 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');

  // Get all collections
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  
  console.log('📚 جميع المجموعات في قاعدة البيانات:\n');
  collections.forEach(col => {
    console.log(`  • ${col.name}`);
  });

  // Look for financial-related collections
  console.log('\n\n📊 البحث عن بيانات مالية:\n');

  // Check Financial collection for total counts
  const financialCount = await Financial.countDocuments();
  console.log(`Financial: ${financialCount} سجل`);

  // Check for any records with earnings or debts
  const financialsWithData = await Financial.find({
    $or: [
      { totalEarnings: { $gt: 0 } },
      { 'transactions.0': { $exists: true } },
      { 'debts.0': { $exists: true } }
    ]
  });

  console.log(`  - بها بيانات: ${financialsWithData.length} سجل`);

  // Check PharmacyFinancial
  const pharmacyFinancialCount = await PharmacyFinancial.countDocuments();
  console.log(`\nPharmacyFinancial: ${pharmacyFinancialCount} سجل`);

  const pharmacyWithData = await PharmacyFinancial.find({
    $or: [
      { totalRevenue: { $gt: 0 } },
      { totalDebts: { $gt: 0 } },
      { 'transactions.0': { $exists: true } },
      { 'debts.0': { $exists: true } }
    ]
  });

  console.log(`  - بها بيانات: ${pharmacyWithData.length} سجل`);

  // Check if there's a ClinicFinancial model
  try {
    const ClinicFinancial = require('./models/ClinicFinancial');
    const clinicFinancialCount = await ClinicFinancial.countDocuments();
    console.log(`\nClinicFinancial: ${clinicFinancialCount} سجل`);
  } catch (e) {
    console.log(`\nClinicFinancial: النموذج غير موجود`);
  }

  console.log('\n\n🔍 البحث عن البيانات المحددة (₪75 إيرادات و ₪55 ديون):\n');

  // Search in Financial
  const matchingFinancials = await Financial.find({
    $or: [
      { totalEarnings: 75 },
      { 'transactions.amount': 75 }
    ]
  });

  if (matchingFinancials.length > 0) {
    console.log(`✅ وجدت في Financial: ${matchingFinancials.length} سجل`);
    matchingFinancials.forEach(f => {
      console.log(`   - ID: ${f._id}`);
      console.log(`   - doctorId: ${f.doctorId}`);
      console.log(`   - totalEarnings: ${f.totalEarnings}`);
    });
  }

  // Search in PharmacyFinancial
  const matchingPharmacy = await PharmacyFinancial.find({
    $or: [
      { totalRevenue: 75 },
      { 'transactions.amount': 75 }
    ]
  });

  if (matchingPharmacy.length > 0) {
    console.log(`✅ وجدت في PharmacyFinancial: ${matchingPharmacy.length} سجل`);
    matchingPharmacy.forEach(p => {
      console.log(`   - ID: ${p._id}`);
      console.log(`   - pharmacyId: ${p.pharmacyId}`);
      console.log(`   - totalRevenue: ${p.totalRevenue}`);
    });
  }

  if (matchingFinancials.length === 0 && matchingPharmacy.length === 0) {
    console.log('❌ لم يتم العثور على البيانات المحددة');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
