const mongoose = require('mongoose');
const User = require('./models/User');

async function fixPharmacyData() {
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
    
    // تحديث البيانات
    pharmacy.subscriptionType = 'paid';
    pharmacy.subscriptionStatus = 'active';
    pharmacy.isPaid = true;
    pharmacy.subscriptionStartDate = new Date();
    pharmacy.subscriptionEndDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    pharmacy.email = pharmacy.email || 'test@pharmacy.com';
    pharmacy.hasAcceptedOffer = false;
    pharmacy.trialUsed = false;
    
    await pharmacy.save();
    
    console.log('✅ تم تحديث البيانات بنجاح!');
    console.log('================================');
    console.log('الاسم:', pharmacy.fullName);
    console.log('الهاتف:', pharmacy.mobileNumber);
    console.log('البريد:', pharmacy.email);
    console.log('المدينة:', pharmacy.city);
    console.log('نوع الاشتراك:', pharmacy.subscriptionType);
    console.log('isPaid:', pharmacy.isPaid);
    console.log('تاريخ البداية:', pharmacy.subscriptionStartDate.toLocaleDateString('ar-SA'));
    console.log('تاريخ النهاية:', pharmacy.subscriptionEndDate.toLocaleDateString('ar-SA'));
    console.log('================================');
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ حدث خطأ:', error.message);
    process.exit(1);
  }
}

fixPharmacyData();
