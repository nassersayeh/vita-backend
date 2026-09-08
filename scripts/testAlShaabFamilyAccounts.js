require('dotenv').config();
const mongoose = require('mongoose');
const accountantController = require('../controllers/accountantController');
const Clinic = require('../models/Clinic');
const User = require('../models/User');

const invoke = (accountant, body) => new Promise((resolve, reject) => {
  const req = { user: accountant, body };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { if (this.statusCode >= 400) reject(new Error(`${this.statusCode}: ${payload.message}`)); else resolve({ status: this.statusCode, payload }); },
  };
  accountantController.registerPatient(req, res).catch(reject);
});

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const clinic = await Clinic.findOne({ name: /(?:مركز\s*)?الشعب|al[\s-]*shaab|al[\s-]*sha'?ab/i, 'staff.role': 'Accountant', 'staff.status': 'active' });
  if (!clinic) throw new Error('No active Al-Shaab accountant was found for the integration test.');
  const accountantEntry = clinic.staff.find((row) => row.role === 'Accountant' && row.status === 'active');
  const accountant = await User.findById(accountantEntry.userId);
  if (!accountant) throw new Error('Al-Shaab accountant user was not found.');
  const suffix = `${Date.now()}`.slice(-7);
  const mobileNumber = `059${suffix}`.slice(0, 10);
  const createdIds = [];
  try {
    for (const [relation, label, digit] of [['son', 'ابن', '1'], ['daughter', 'ابنة', '2']]) {
      const result = await invoke(accountant, { fullName: `VITA FAMILY TEST ${label}`, mobileNumber, idNumber: `99${suffix}${digit}`, householdRelation: relation, country: 'Palestine', city: 'Nablus' });
      createdIds.push(result.payload.patient._id);
    }
    const count = await User.countDocuments({ _id: { $in: createdIds }, mobileNumber });
    if (count !== 2) throw new Error(`Expected two family profiles with the same phone, found ${count}.`);
    console.log('PASS: two Al-Shaab family profiles were created with the same mobile number.');
  } finally {
    if (createdIds.length) {
      await User.updateMany({ patients: { $in: createdIds } }, { $pull: { patients: { $in: createdIds } } });
      await User.deleteMany({ _id: { $in: createdIds } });
    }
    console.log(`Cleanup complete: removed ${createdIds.length} test profile(s).`);
    await mongoose.disconnect();
  }
}

run().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
