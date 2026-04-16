const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

mongoose.connect(MONGODB_URI).then(async () => {
  const User = require('./models/User');
  const Clinic = require('./models/Clinic');

  const clinic = await Clinic.findOne({ name: /شعب/i });
  if (!clinic) { console.log('Clinic not found'); process.exit(1); }
  console.log('Clinic:', clinic.name, clinic._id);

  const existing = await User.findOne({ mobileNumber: '970594642997' });
  if (existing) { console.log('Phone already exists:', existing.fullName, existing.role, existing._id); process.exit(1); }

  const hashedPassword = await bcrypt.hash('123456789', 10);
  const newUser = new User({
    fullName: 'يافا حجاب',
    mobileNumber: '970594642997',
    password: hashedPassword,
    role: 'LabTech',
    country: 'Palestine',
    city: 'الخليل',
    idNumber: 'LT' + Date.now(),
    address: 'الخليل',
    sex: 'Female',
    email: 'yafa.hijab@alshaab.clinic',
    clinicId: clinic._id,
    activationStatus: 'active',
    isPhoneVerified: true,
  });

  await newUser.save();
  console.log('تم إنشاء حساب فني المختبر');
  console.log('الاسم:', newUser.fullName);
  console.log('ID:', newUser._id);
  console.log('الهاتف:', newUser.mobileNumber);
  console.log('الباسويرد: 123456789');
  console.log('العيادة:', clinic.name);
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
