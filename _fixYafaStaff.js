const mongoose = require('mongoose');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

mongoose.connect(MONGODB_URI).then(async () => {
  const Clinic = require('./models/Clinic');
  const User = require('./models/User');

  const yafa = await User.findOne({ mobileNumber: '970594642997' });
  if (!yafa) { console.log('User not found'); process.exit(1); }
  console.log('User:', yafa.fullName, '| ID:', yafa._id, '| clinicId:', yafa.clinicId);

  const clinic = await Clinic.findOne({ name: /شعب|مستوصف/i });
  if (!clinic) { console.log('Clinic not found'); process.exit(1); }
  console.log('Clinic:', clinic.name, '| ID:', clinic._id);
  
  // Check staff array
  const staffEntry = clinic.staff?.find(s => s.userId?.toString() === yafa._id.toString());
  console.log('In staff array:', staffEntry ? 'YES' : 'NO');
  
  if (!staffEntry) {
    // Add her to staff
    if (!clinic.staff) clinic.staff = [];
    clinic.staff.push({
      userId: yafa._id,
      role: 'LabTech',
      status: 'active',
      name: yafa.fullName
    });
    await clinic.save();
    console.log('Added to staff array!');
  }

  // Verify
  const updated = await Clinic.findById(clinic._id);
  console.log('Staff count:', updated.staff?.length);
  updated.staff?.forEach(s => console.log(' -', s.name || s.userId, '|', s.role, '|', s.status));
  
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
