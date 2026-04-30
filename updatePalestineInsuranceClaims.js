const mongoose = require('mongoose');
const InsuranceClaim = require('./models/InsuranceClaim');

require('dotenv').config();

const MONGO_URI = 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function updatePalestineInsuranceClaims() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✓ تم الاتصال بقاعدة البيانات\n');

    // البحث عن مطالبات شركة فلسطين للتأمين
    const claims = await InsuranceClaim.find({ 
      insuranceCompany: 'شركة فلسطين للتأمين - Palestine Insurance'
    });

    console.log(`وجدنا ${claims.length} مطالبة لشركة فلسطين للتأمين\n`);

    if (claims.length > 0) {
      console.log('→ المطالبات المراد نقلها:');
      claims.forEach(c => {
        console.log(`  - رقم المطالبة: ${c._id} | الصيدلية: ${c.pharmacyName} | الشهر: ${c.claimMonth}/${c.claimYear} | المبلغ: ${c.claimsValue}`);
      });

      // نقل المطالبات
      const result = await InsuranceClaim.updateMany(
        { insuranceCompany: 'شركة فلسطين للتأمين - Palestine Insurance' },
        { $set: { insuranceCompany: 'اتش اي اس "فلسطين" - HIS "Palestine"' } }
      );

      console.log(`\n✓ تم نقل ${result.modifiedCount} مطالبة إلى: اتش اي اس "فلسطين" - HIS "Palestine"`);
    } else {
      console.log('⚠ لم نجد مطالبات لشركة فلسطين للتأمين');
    }

    console.log('\n✓ اكتملت العملية بنجاح');
    process.exit(0);
  } catch (error) {
    console.error('✗ خطأ:', error.message);
    process.exit(1);
  }
}

updatePalestineInsuranceClaims();
