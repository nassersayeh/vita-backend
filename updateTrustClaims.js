const mongoose = require('mongoose');
const InsuranceClaim = require('./models/InsuranceClaim');

require('dotenv').config();

const MONGO_URI = 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function updateTrustClaims() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✓ تم الاتصال بقاعدة البيانات\n');

    // البحث عن مطالبات شركة ترست
    const claims = await InsuranceClaim.find({ 
      insuranceCompany: 'شركة ترست العالمية للتأمين - Trust'
    });

    console.log(`وجدنا ${claims.length} مطالبة لشركة ترست العالمية\n`);

    if (claims.length > 0) {
      console.log('→ المطالبات المراد نقلها:');
      claims.forEach(c => {
        console.log(`  - رقم المطالبة: ${c._id} | الصيدلية: ${c.pharmacyName} | الشهر: ${c.claimMonth}/${c.claimYear} | المبلغ: ${c.claimsValue}`);
      });

      // نقل المطالبات
      const result = await InsuranceClaim.updateMany(
        { insuranceCompany: 'شركة ترست العالمية للتأمين - Trust' },
        { $set: { insuranceCompany: 'سمارت هيلث "ترست" - Smart Health "Trust"' } }
      );

      console.log(`\n✓ تم نقل ${result.modifiedCount} مطالبة إلى: سمارت هيلث "ترست" - Smart Health "Trust"`);
    } else {
      console.log('⚠ لم نجد مطالبات لشركة ترست العالمية');
    }

    console.log('\n✓ اكتملت العملية بنجاح');
    process.exit(0);
  } catch (error) {
    console.error('✗ خطأ:', error.message);
    process.exit(1);
  }
}

updateTrustClaims();
