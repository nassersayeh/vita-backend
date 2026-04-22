const mongoose = require('mongoose');
const User = require('./models/User');

async function checkPharmacyData() {
  try {
    await mongoose.connect('mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin');
    
    const pharmacy = await User.findOne({ 
      mobileNumber: '0566000000',
      role: 'Pharmacy'
    });
    
    if (!pharmacy) {
      console.log('❌ لم يتم العثور على الصيدلية');
      await mongoose.disconnect();
      process.exit(1);
    }
    
    console.log('بيانات الصيدلية الحالية:');
    console.log('================================');
    console.log('الاسم:', pharmacy.fullName);
    console.log('الهاتف:', pharmacy.mobileNumber);
    console.log('البريد:', pharmacy.email);
    console.log('المدينة:', pharmacy.city);
    console.log('العنوان:', pharmacy.address);
    console.log('نوع الاشتراك:', pharmacy.subscriptionType);
    console.log('حالة الاشتراك:', pharmacy.subscriptionStatus);
    console.log('تاريخ البداية:', pharmacy.subscriptionStartDate);
    console.log('تاريخ النهاية:', pharmacy.subscriptionEndDate);
    console.log('isPaid:', pharmacy.isPaid);
    console.log('================================');
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ حدث خطأ:', error.message);
    process.exit(1);
  }
}

checkPharmacyData();
