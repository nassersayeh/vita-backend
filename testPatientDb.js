// Quick test to verify patient registration
const mongoose = require('mongoose');
const User = require('./models/User');

async function testPatientRegistration() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/vita');
    console.log('✓ Connected to database');

    // Find a recent User document (patient)
    const recentUsers = await User.find({ role: 'User' }).sort({ createdAt: -1 }).limit(5);
    console.log('\nآخر 5 مرضى مسجلين:');
    recentUsers.forEach((user, idx) => {
      console.log(`${idx + 1}. ${user.fullName} (${user.mobileNumber}) - ${user.createdAt.toLocaleString()}`);
    });

    console.log('\n✓ اختبار اكتمل بنجاح');
    process.exit(0);
  } catch (error) {
    console.error('✗ خطأ:', error.message);
    process.exit(1);
  }
}

testPatientRegistration();
