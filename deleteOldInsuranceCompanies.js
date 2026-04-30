const mongoose = require('mongoose');
const InsuranceCompany = require('./models/InsuranceCompany');

require('dotenv').config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

// الشركات المراد حذفها من قاعدة البيانات
const companiesToDelete = [
  'شركة التأمين العربية',
  'شركة التأمين العربية - AIC',
  'AIC',
  'شركة ميثاق',
  'شركة ميثاق للتأمين',
  'Mithaq',
  'ميد كير',
  'شركة ميد كير',
  'MedCare',
  'نيست كير',
  'نيكست كير',
  'NextCare',
  'ميد نت',
  'MedNet',
  'شركة جلوبال المتحدة',
  'شركة جلوبال المتحدة للتأمين',
  'Global United',
  'شركة الائتلاف',
  'شركة الائتلاف للتأمين',
  'Al Etilaf',
  'التكافل الفلسطيني',
  'التكافل الفلسطيني للتأمين',
  'Takaful'
];

async function deleteInsuranceCompanies() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✓ تم الاتصال بقاعدة البيانات');

    for (const companyName of companiesToDelete) {
      const result = await InsuranceCompany.deleteMany({
        $or: [
          { name: companyName },
          { nameAr: companyName }
        ]
      });

      if (result.deletedCount > 0) {
        console.log(`✓ تم حذف "${companyName}" (${result.deletedCount} سجل)`);
      }
    }

    console.log('\n✓ اكتملت عملية الحذف بنجاح');
    process.exit(0);
  } catch (error) {
    console.error('✗ خطأ:', error.message);
    process.exit(1);
  }
}

deleteInsuranceCompanies();
