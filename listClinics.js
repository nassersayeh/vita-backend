// listClinics.js
const mongoose = require('mongoose');
const Clinic = require('./models/Clinic');

const MONGODB_URI = 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');

  const clinics = await Clinic.find();
  console.log(`Found ${clinics.length} clinic(s):\n`);
  
  clinics.forEach((clinic, index) => {
    console.log(`${index + 1}. ID: ${clinic._id}`);
    console.log(`   Name: ${clinic.name}`);
    console.log(`   Owner: ${clinic.ownerId}`);
    console.log(`   Doctors: ${clinic.doctors?.length || 0}`);
    console.log(`   Staff: ${clinic.staff?.length || 0}`);
    console.log('');
  });

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
