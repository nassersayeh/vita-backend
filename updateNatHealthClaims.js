const mongoose = require('mongoose');
const InsuranceClaim = require('./models/InsuranceClaim');

require('dotenv').config();

const MONGO_URI = 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function updateNatHealthClaims() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✓ تم الاتصال بقاعدة البيانات\n');

    // البحث عن مطالبات نات هيلث
    const claims = await InsuranceClaim.find({ 
      insuranceCompany: 'نات هيلث - NatHealth'
    });

    console.log(`وجدنا ${claims.length} مطالبة لشركة نات هيلث\n`);

    if (claims.length > 0) {
      console.log('→ المطالبات المراد نقلها:');
      claims.forEach(c => {
        console.log(`  - رقم المطالبة: ${c._id} | الصيدلية: ${c.pharmacyName} | الشهر: ${c.claimMonth}/${c.claimYear} | المبلغ: ${c.claimsValue}`);
      });

      // نقل المطالبات
      const result = await InsuranceClaim.updateMany(
        { insuranceCompany: 'نات هيلث - NatHealth' },
        { $set: { insuranceCompany: 'نات هيلث - NatHealth - NatHealth' } }
      );

      console.log(`\n✓ تم نقل ${result.modifiedCount} مطالبة إلى: نات هيلث - NatHealth - NatHealth`);
    } else {
      console.log('⚠ لم نجد مطالبات لشركة نات هيلث');
    }

    console.log('\n✓ اكتملت العملية بنجاح');
    process.exit(0);
  } catch (error) {
    console.error('✗ خطأ:', error.message);
    process.exit(1);
  }
}

updateNatHealthClaims();
