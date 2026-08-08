const mongoose = require('mongoose');
const User = require('./models/User');
const Prescription = require('./models/EPrescription');
const Clinic = require('./models/Clinic');
const URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';
async function run() {
  await mongoose.connect(URI);
  const pharmacy = await User.findOne({ role: 'Pharmacy', internalDepartment: 'pharmacy', fullName: 'صيدلية مركز العقم' }).select('_id clinicId');
  if (!pharmacy) throw new Error('Fertility pharmacy not found');
  const clinic = await Clinic.findById(pharmacy.clinicId).select('doctors');
  const doctorIds = (clinic?.doctors || []).filter(d => d.status === 'active').map(d => d.doctorId);
  // Include legacy prescriptions created by this clinic's doctors, even if
  // they predate routedTo/clinicId fields. No other clinic is touched.
  const filter = { $or: [{ routedTo: pharmacy._id }, { dispensedBy: pharmacy._id }, { clinicId: pharmacy.clinicId }, { doctorId: { $in: doctorIds } }] };
  const count = await Prescription.countDocuments(filter);
  console.log({ database: mongoose.connection.name, pharmacyId: pharmacy._id.toString(), clinicId: pharmacy.clinicId?.toString(), doctorCount: doctorIds.length, matched: count, dryRun: process.env.CONFIRM !== 'DELETE_FERTILITY_PHARMACY_PRESCRIPTIONS' });
  if (process.env.CONFIRM === 'DELETE_FERTILITY_PHARMACY_PRESCRIPTIONS') console.log(await Prescription.deleteMany(filter));
}
run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
