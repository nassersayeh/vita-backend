require('dotenv').config();
const mongoose = require('mongoose');
const MedicalTest = require('../models/MedicalTest');
const User = require('../models/User');

const services = [
  ['Full mouth CBCT', '3D Imaging'],
  ['Upper Jaw CBCT', '3D Imaging'],
  ['Lower Jaw CBCT', '3D Imaging'],
  ['Partial CBCT', '3D Imaging'],
  ['Impacted Tooth', '3D Imaging'],
  ['3D view', '3D Imaging'],
  ['Sinuses CBCT', '3D Imaging'],
  ['T.M.J CBCT', '3D Imaging'],
  ['Panoramic X-Ray', '2D Imaging'],
  ['Panoramic ++', '2D Imaging'],
  ['Bite-Wing', '2D Imaging'],
  ['Sinuses X-Ray', '2D Imaging'],
  ['T.M.J Standard', '2D Imaging'],
];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const collection = mongoose.connection.collection('medicaltests');
  const indexes = await collection.indexes();
  for (const index of indexes) {
    if (index.unique && Object.keys(index.key).length === 1 && index.key.name === 1) await collection.dropIndex(index.name);
  }
  await collection.createIndex({ providerId: 1, name: 1 }, { unique: true, name: 'provider_service_name_unique' });

  const centers = await User.find({ role: 'Radiology', activationStatus: 'active', $or: [{ fullName: /البرج/i }, { fullName: /al\s*burj/i }, { fullName: /albourj/i }] }).select('_id fullName').lean();
  if (centers.length !== 2) throw new Error(`Expected exactly 2 active Al Burj branches, found ${centers.length}.`);
  const names = services.map(([name]) => name);
  await MedicalTest.updateMany({ providerId: { $in: centers.map((center) => center._id) }, type: 'radiology', name: { $nin: names } }, { $set: { isActive: false } });
  for (const center of centers) {
    for (const [name, category] of services) {
      await MedicalTest.findOneAndUpdate(
        { providerId: center._id, name },
        { $set: { type: 'radiology', category, price: 0, isActive: true, description: '', estimatedDuration: 30, createdBy: center._id } },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
      );
    }
  }
  const counts = await Promise.all(centers.map(async (center) => ({ center: center.fullName, activeServices: await MedicalTest.countDocuments({ providerId: center._id, type: 'radiology', isActive: true }), nonZeroPrices: await MedicalTest.countDocuments({ providerId: center._id, type: 'radiology', isActive: true, price: { $ne: 0 } }) })));
  console.log(JSON.stringify(counts, null, 2));
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
