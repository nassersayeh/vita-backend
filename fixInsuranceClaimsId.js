// fixInsuranceClaimsId.js - Add insuranceCompanyId to old claims
const mongoose = require('mongoose');
const InsuranceClaim = require('./models/InsuranceClaim');
const InsuranceCompany = require('./models/InsuranceCompany');

const MONGODB_URI = 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');

  // Get all insurance companies
  const companies = await InsuranceCompany.find({}).select('_id name nameAr');
  console.log(`📍 عدد شركات التأمين: ${companies.length}\n`);

  // Create a map of company names to IDs
  const companyMap = {};
  companies.forEach(c => {
    // Map both formats: "Arabic - English" and just the Arabic name
    const fullName = `${c.nameAr} - ${c.name}`;
    const arabicName = c.nameAr;
    
    companyMap[fullName] = c._id;
    companyMap[arabicName] = c._id;
    
    console.log(`📦 ${fullName}`);
    console.log(`   ID: ${c._id}\n`);
  });

  // Find claims without insuranceCompanyId
  const claimsWithoutId = await InsuranceClaim.find({ 
    insuranceCompanyId: { $exists: false } 
  }).select('_id insuranceCompany pharmacyId createdAt');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔍 البحث عن المطالبات بدون insuranceCompanyId:\n`);
  console.log(`عدد المطالبات: ${claimsWithoutId.length}\n`);

  if (claimsWithoutId.length === 0) {
    console.log('✅ جميع المطالبات تملك insuranceCompanyId\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  // Group by insurance company name
  const claimsByCompany = {};
  claimsWithoutId.forEach(claim => {
    const companyName = claim.insuranceCompany.trim();
    if (!claimsByCompany[companyName]) {
      claimsByCompany[companyName] = [];
    }
    claimsByCompany[companyName].push(claim);
  });

  console.log('المطالبات حسب شركة التأمين:\n');
  let totalToUpdate = 0;
  const updateLog = [];

  for (const [companyName, claims] of Object.entries(claimsByCompany)) {
    const companyId = companyMap[companyName];
    console.log(`📋 ${companyName}`);
    console.log(`   عدد المطالبات: ${claims.length}`);
    
    if (companyId) {
      console.log(`   ✅ سيتم التحديث برقم ID: ${companyId}`);
      totalToUpdate += claims.length;
      updateLog.push({ companyName, companyId, claimsCount: claims.length });
    } else {
      console.log(`   ❌ لم يتم العثور على شركة مطابقة في قاعدة البيانات`);
      console.log(`   المطالبات التي لا يمكن تحديثها: ${claims.length}`);
    }
    console.log('');
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 ملخص التحديث:\n`);
  console.log(`إجمالي المطالبات المراد تحديثها: ${totalToUpdate}`);
  console.log(`إجمالي المطالبات بدون مطابقة: ${claimsWithoutId.length - totalToUpdate}\n`);

  // Perform the update
  console.log(`${'='.repeat(60)}`);
  console.log(`🔄 جاري تحديث المطالبات...\n`);

  let updatedCount = 0;
  let errorCount = 0;

  for (const { companyName, companyId } of updateLog) {
    try {
      const result = await InsuranceClaim.updateMany(
        { 
          insuranceCompany: companyName,
          insuranceCompanyId: { $exists: false }
        },
        { 
          $set: { insuranceCompanyId: companyId }
        }
      );
      
      updatedCount += result.modifiedCount;
      console.log(`✅ ${companyName}`);
      console.log(`   تم تحديث: ${result.modifiedCount} مطالبة`);
      console.log(`   رقم ID: ${companyId}\n`);
    } catch (error) {
      errorCount++;
      console.log(`❌ خطأ في تحديث ${companyName}`);
      console.log(`   ${error.message}\n`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ تم انتهاء التحديث!\n`);
  console.log(`📝 الملخص النهائي:\n`);
  console.log(`• تم تحديث: ${updatedCount} مطالبة`);
  console.log(`• حدثت أخطاء في: ${errorCount} عملية`);
  console.log(`• المطالبات المتبقية بدون ID: ${claimsWithoutId.length - updatedCount}\n`);

  // Verify the updates
  console.log(`${'='.repeat(60)}`);
  console.log(`🔍 التحقق من التحديثات:\n`);

  const claimsStillWithoutId = await InsuranceClaim.find({ 
    insuranceCompanyId: { $exists: false } 
  }).select('_id insuranceCompany').limit(5);

  if (claimsStillWithoutId.length === 0) {
    console.log('✅ جميع المطالبات تملك insuranceCompanyId الآن!\n');
  } else {
    console.log(`⚠️ لا تزال هناك ${claimsStillWithoutId.length} مطالبة بدون ID:\n`);
    claimsStillWithoutId.forEach(c => {
      console.log(`• ${c.insuranceCompany}`);
    });
    console.log('');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
