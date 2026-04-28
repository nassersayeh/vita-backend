const mongoose = require('mongoose');
const InsuranceClaim = require('./models/InsuranceClaim');

// قائمة الشركات المراد حذفها ونقل مطالباتها
const companiesToMigrate = {
  'شركة التامين العربية': null, // حذف مباشرة
  'شركة ميثاق': null, // حذف مباشرة
  'ميد كير': 'بال ميد سيرفيس',
  'نيست كير': null, // حذف مباشرة
  'ميد نت': null, // حذف مباشرة
  'شركة جلوبال المتحدة': 'جلوب ميد',
  'شركة الائتلاف': null, // حذف مباشرة
  'التكافل الفلسطيني للتامين': null, // حذف مباشرة
  'شركة التامين الوطني': 'نات هيلث'
};

async function migrateInsuranceCompanies() {
  try {
    // الاتصال بقاعدة البيانات
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/vita', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('✓ تم الاتصال بقاعدة البيانات');

    // للشركات التي لها بديل - نقل المطالبات
    for (const [oldCompany, newCompany] of Object.entries(companiesToMigrate)) {
      if (newCompany) {
        console.log(`\n→ نقل مطالبات "${oldCompany}" إلى "${newCompany}"`);
        
        // عد المطالبات القديمة
        const count = await InsuranceClaim.countDocuments({ insuranceCompany: oldCompany });
        console.log(`  عدد المطالبات المراد نقلها: ${count}`);
        
        if (count > 0) {
          // نقل المطالبات
          const result = await InsuranceClaim.updateMany(
            { insuranceCompany: oldCompany },
            { $set: { insuranceCompany: newCompany } }
          );
          
          console.log(`  ✓ تم نقل ${result.modifiedCount} مطالبة`);
        }
      }
    }

    // حذف المطالبات من الشركات المراد حذفها بالكامل
    for (const [company, newCompany] of Object.entries(companiesToMigrate)) {
      if (!newCompany) {
        console.log(`\n✗ حذف جميع مطالبات "${company}"`);
        
        const count = await InsuranceClaim.countDocuments({ insuranceCompany: company });
        console.log(`  عدد المطالبات المراد حذفها: ${count}`);
        
        if (count > 0) {
          const result = await InsuranceClaim.deleteMany({ insuranceCompany: company });
          console.log(`  ✓ تم حذف ${result.deletedCount} مطالبة`);
        }
      }
    }

    console.log('\n✓ اكتملت العملية بنجاح');
    process.exit(0);
  } catch (error) {
    console.error('✗ خطأ:', error.message);
    process.exit(1);
  }
}

// تشغيل السكريبت
migrateInsuranceCompanies();
