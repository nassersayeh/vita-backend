const mongoose = require('mongoose');
const InsuranceClaim = require('./models/InsuranceClaim');
const Claim = require('./models/Claim');
const InsuranceCompany = require('./models/InsuranceCompany');

require('dotenv').config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

// خريطة الأسماء - من القديم إلى الجديد
const nameMapping = {
  // الشركات المراد حذفها بالكامل
  'شركة التأمين العربية': null,
  'AIC': null,
  'شركة ميثاق': null,
  'Mithaq': null,
  'ميد كير': null,
  'شركة ميد كير': null,
  'MedCare': null,
  'نيست كير': null,
  'نيكست كير': null,
  'NextCare': null,
  'ميد نت': null,
  'MedNet': null,
  'شركة جلوبال المتحدة': null,
  'شركة جلوبال المتحدة للتأمين': null,
  'Global United': null,
  'شركة الائتلاف': null,
  'شركة الائتلاف للتأمين': null,
  'Al Etilaf': null,
  'التكافل الفلسطيني': null,
  'التكافل الفلسطيني للتأمين': null,
  'Takaful': null,
  
  // الشركات المراد نقل مطالباتها
  'شركة المشرق للتأمين - Al Mashreq': 'بال ميد سيرفيس',
  'Al Mashreq': 'بال ميد سيرفيس',
  'شركة المشرق للتأمين': 'بال ميد سيرفيس',
  'جلوب ميد فلسطين - GlobeMed Palestine - GlobeMed Palestine': 'جلوب ميد فلسطين - GlobeMed Palestine',
};

async function cleanupInsuranceData() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✓ تم الاتصال بقاعدة البيانات\n');

    // 1. نقل المطالبات للأسماء الصحيحة
    console.log('→ نقل المطالبات للأسماء الصحيحة');
    for (const [oldName, newName] of Object.entries(nameMapping)) {
      if (newName) {
        // في جدول InsuranceClaim (مطالبات الصيدليات - النصية)
        const claimCount = await InsuranceClaim.countDocuments({ insuranceCompany: oldName });
        if (claimCount > 0) {
          const result = await InsuranceClaim.updateMany(
            { insuranceCompany: oldName },
            { $set: { insuranceCompany: newName } }
          );
          console.log(`  ✓ نقل ${result.modifiedCount} مطالبة من "${oldName}" إلى "${newName}"`);
        }
      }
    }

    // 2. حذف المطالبات من الشركات التي ستحذف
    console.log('\n→ حذف المطالبات من الشركات المراد حذفها');
    for (const [company, replacement] of Object.entries(nameMapping)) {
      if (!replacement) {
        const count = await InsuranceClaim.countDocuments({ insuranceCompany: company });
        if (count > 0) {
          const result = await InsuranceClaim.deleteMany({ insuranceCompany: company });
          console.log(`  ✓ حذف ${result.deletedCount} مطالبة من "${company}"`);
        }
      }
    }

    // 3. حذف حسابات شركات التامين من قاعدة البيانات
    console.log('\n→ حذف حسابات شركات التامين');
    const companiesToDelete = [
      { name: 'MedCare', nameAr: 'ميد كير' },
      { name: 'MedCare', nameAr: 'شركة ميد كير - MedCare' },
      { name: 'Mithaq', nameAr: 'شركة ميثاق للتأمين' },
      { name: 'NextCare', nameAr: 'نيكست كير - NextCare' },
      { name: 'MedNet', nameAr: 'ميد نت - MedNet' },
      { name: 'AIC', nameAr: 'شركة التأمين العربية - AIC' },
      { name: 'Al Etilaf', nameAr: 'شركة الائتلاف للتأمين - Al Etilaf' },
      { name: 'Takaful', nameAr: 'التكافل الفلسطيني للتأمين - Takaful' },
    ];

    for (const company of companiesToDelete) {
      const result = await InsuranceCompany.deleteMany({
        $or: [{ name: company.name }, { nameAr: company.nameAr }]
      });
      if (result.deletedCount > 0) {
        console.log(`  ✓ حذف حساب "${company.nameAr}" (${result.deletedCount} سجل)`);
      }
    }

    // 4. تصحيح شركة Al Mashreq
    console.log('\n→ تصحيح شركة Al Mashreq');
    const almashreqCompanies = await InsuranceCompany.find({
      $or: [
        { name: 'Al Mashreq' },
        { nameAr: { $regex: 'شركة المشرق' } }
      ]
    });

    for (const company of almashreqCompanies) {
      // تحديث الاسم
      company.name = 'Pal Med Service';
      company.nameAr = 'بال ميد سيرفيس';
      company.username = 'palmmedservice';
      await company.save();
      console.log(`  ✓ تم تحديث: ${company._id} إلى "بال ميد سيرفيس"`);
    }

    // 5. تصحيح التكرارات في GlobeMed
    console.log('\n→ تصحيح تكرارات GlobeMed');
    const duplicateGlobeMedClaims = await InsuranceClaim.find({
      insuranceCompany: 'جلوب ميد فلسطين - GlobeMed Palestine - GlobeMed Palestine'
    });
    
    if (duplicateGlobeMedClaims.length > 0) {
      const result = await InsuranceClaim.updateMany(
        { insuranceCompany: 'جلوب ميد فلسطين - GlobeMed Palestine - GlobeMed Palestine' },
        { $set: { insuranceCompany: 'جلوب ميد فلسطين - GlobeMed Palestine' } }
      );
      console.log(`  ✓ تصحيح ${result.modifiedCount} مطالبة من التكرار`);
    }

    console.log('\n✓ اكتملت العملية بنجاح');
    process.exit(0);
  } catch (error) {
    console.error('✗ خطأ:', error.message);
    process.exit(1);
  }
}

cleanupInsuranceData();
