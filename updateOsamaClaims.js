const mongoose = require('mongoose');
const InsuranceClaim = require('./models/InsuranceClaim');

require('dotenv').config();

const MONGO_URI = 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function updateOsamaPharmacyClaims() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✓ تم الاتصال بقاعدة البيانات\n');

    // البحث عن مطالبات صيدلية اسامة ببال ميد سيرفيس
    const claims = await InsuranceClaim.find({ 
      $or: [
        { pharmacyName: { $regex: 'اسامة', $options: 'i' } },
        { pharmacyName: { $regex: 'osama', $options: 'i' } }
      ],
      insuranceCompany: 'بال ميد سيرفيس'
    });

    console.log(`وجدنا ${claims.length} مطالبة لصيدلية اسامة ببال ميد سيرفيس\n`);

    if (claims.length > 0) {
      console.log('→ المطالبات المراد نقلها:');
      claims.forEach(c => {
        console.log(`  - رقم المطالبة: ${c._id} | الشهر: ${c.claimMonth}/${c.claimYear} | المبلغ: ${c.claimsValue}`);
      });

      // نقل المطالبات
      const result = await InsuranceClaim.updateMany(
        { 
          $or: [
            { pharmacyName: { $regex: 'اسامة', $options: 'i' } },
            { pharmacyName: { $regex: 'osama', $options: 'i' } }
          ],
          insuranceCompany: 'بال ميد سيرفيس'
        },
        { $set: { insuranceCompany: 'بال ميد سيرفيس "المشرق" - Pal Med Service "Al Mashreq"' } }
      );

      console.log(`\n✓ تم نقل ${result.modifiedCount} مطالبة إلى: بال ميد سيرفيس "المشرق" - Pal Med Service "Al Mashreq"`);
    } else {
      console.log('⚠ لم نجد مطالبات لصيدلية اسامة ببال ميد سيرفيس');
    }

    console.log('\n✓ اكتملت العملية بنجاح');
    process.exit(0);
  } catch (error) {
    console.error('✗ خطأ:', error.message);
    process.exit(1);
  }
}

updateOsamaPharmacyClaims();
