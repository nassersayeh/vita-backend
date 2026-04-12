/**
 * Quick verification: Compare actual vs expected for each doctor
 */
const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function run() {
  await mongoose.connect(MONGO_URI);
  const Clinic = require('../models/Clinic');
  const User = require('../models/User');
  const Financial = require('../models/Financial');

  const clinic = await Clinic.findOne({ name: /الشعب/i });
  const doctors = clinic.doctors.filter(d => d.status === 'active');

  console.log('VERIFICATION - Doctor Financials After Fix:\n');

  let totalDoctors = 0;
  for (const doc of doctors) {
    const user = await User.findById(doc.doctorId).select('fullName');
    const fin = await Financial.findOne({ doctorId: doc.doctorId });
    const txSum = (fin?.transactions || []).reduce((s, t) => s + t.amount, 0);
    totalDoctors += fin?.totalEarnings || 0;
    console.log(`  ${(user?.fullName || 'unknown').padEnd(20)} | totalEarnings: ₪${(fin?.totalEarnings || 0).toString().padStart(6)} | txSum: ₪${txSum.toString().padStart(6)} | tx count: ${(fin?.transactions?.length || 0)}`);
    console.log(`     match: ${fin?.totalEarnings === txSum ? '✅' : '❌'}`);
  }

  const ownerFin = await Financial.findOne({ doctorId: clinic.ownerId });
  console.log(`\n  Clinic Owner         | totalEarnings: ₪${ownerFin?.totalEarnings} | txSum: ₪${(ownerFin?.transactions || []).reduce((s, t) => s + t.amount, 0)}`);
  console.log(`\n  Sum all doctors: ₪${totalDoctors}`);
  console.log(`  Owner transactions: ₪${(ownerFin?.transactions || []).reduce((s, t) => s + t.amount, 0)}`);
  console.log(`  Should match: ${totalDoctors === (ownerFin?.transactions || []).reduce((s, t) => s + t.amount, 0) ? '✅' : '❌'}`);

  await mongoose.connection.close();
}
run().catch(console.error);
