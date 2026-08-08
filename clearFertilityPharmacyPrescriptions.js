const mongoose = require('mongoose');
const User = require('./models/User');
const Prescription = require('./models/EPrescription');
const URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';
async function run() {
  await mongoose.connect(URI);
  const pharmacy = await User.findOne({ role: 'Pharmacy', internalDepartment: 'pharmacy', fullName: 'صيدلية مركز العقم' }).select('_id');
  if (!pharmacy) throw new Error('Fertility pharmacy not found');
  const filter = { routedTo: pharmacy._id };
  const count = await Prescription.countDocuments(filter);
  console.log({ pharmacyId: pharmacy._id.toString(), matched: count, dryRun: process.env.CONFIRM !== 'DELETE_FERTILITY_PHARMACY_PRESCRIPTIONS' });
  if (process.env.CONFIRM === 'DELETE_FERTILITY_PHARMACY_PRESCRIPTIONS') console.log(await Prescription.deleteMany(filter));
}
run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
