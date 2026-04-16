const mongoose = require('mongoose');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

mongoose.connect(MONGODB_URI).then(async () => {
  const Clinic = require('./models/Clinic');
  const User = require('./models/User');

  const clinic = await Clinic.findOne({ name: /شعب/i });
  if (!clinic) { console.log('Clinic not found'); process.exit(1); }

  console.log('Before:', clinic.name, '|', clinic.phone, '|', clinic.address);

  clinic.name = 'مستوصف الشعب الطبي';
  clinic.phone = '970597358272';
  clinic.address = 'نابلس مخيم عسكر الجديد قرب صيدلية تيم';
  await clinic.save();

  // Also update the Clinic owner User record
  const owner = await User.findById(clinic.ownerId);
  if (owner) {
    owner.fullName = 'مستوصف الشعب الطبي';
    owner.mobileNumber = '970597358272';
    owner.address = 'نابلس مخيم عسكر الجديد قرب صيدلية تيم';
    await owner.save();
    console.log('Owner updated:', owner.fullName);
  }

  console.log('After:', clinic.name, '|', clinic.phone, '|', clinic.address);
  console.log('Done!');
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
