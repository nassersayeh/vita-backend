const mongoose = require('mongoose');
const User = require('./models/User');

async function updatePharmacy() {
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
    
    console.log('✅ تم العثور على الصيدلية:', pharmacy.fullName);
    console.log('الحساب الحالي:', pharmacy.subscriptionType || 'غير محدد');
    
    // تحديث الحساب
    pharmacy.subscriptionType = 'paid';
    pharmacy.subscriptionStatus = 'active';
    pharmacy.subscriptionStartDate = new Date();
    pharmacy.subscriptionEndDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // سنة واحدة
    
    await pharmacy.save();
    
    console.log('✅ تم تحويل الحساب إلى مدفوع بنجاح!');
    console.log('الحساب الجديد:', pharmacy.subscriptionType);
    console.log('تاريخ البداية:', pharmacy.subscriptionStartDate.toLocaleDateString('ar-SA'));
    console.log('تاريخ النهاية:', pharmacy.subscriptionEndDate.toLocaleDateString('ar-SA'));
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ حدث خطأ:', error.message);
    process.exit(1);
  }
}

updatePharmacy();
