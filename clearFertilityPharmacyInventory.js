/*
 * Remove all medicine records belonging only to the infertility center's
 * internal pharmacy. Safe by default: run with CONFIRM=DELETE_FERTILITY_PHARMACY
 * to perform the deletion; without it the script only prints what it found.
 */
const mongoose = require('mongoose');
const User = require('./models/User');
const PharmacyInventory = require('./models/PharmacyInventory');
const Product = require('./models/Product');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function run() {
  await mongoose.connect(MONGODB_URI);
  const pharmacy = await User.findOne({
    role: 'Pharmacy',
    internalDepartment: 'pharmacy',
    fullName: 'صيدلية مركز العقم'
  }).select('_id fullName mobileNumber clinicId');

  if (!pharmacy) throw new Error('Fertility center pharmacy account was not found; nothing was changed.');

  const filter = { pharmacyId: pharmacy._id };
  const [inventoryCount, productsCount] = await Promise.all([
    PharmacyInventory.countDocuments(filter),
    Product.countDocuments(filter)
  ]);

  console.log(JSON.stringify({ pharmacy, inventoryCount, productsCount, dryRun: process.env.CONFIRM !== 'DELETE_FERTILITY_PHARMACY' }, null, 2));

  if (process.env.CONFIRM !== 'DELETE_FERTILITY_PHARMACY') {
    console.log('Dry run only. Re-run with CONFIRM=DELETE_FERTILITY_PHARMACY to remove these records.');
    return;
  }

  const [inventoryResult, productsResult] = await Promise.all([
    PharmacyInventory.deleteMany(filter),
    Product.deleteMany(filter)
  ]);
  console.log(JSON.stringify({ deletedInventory: inventoryResult.deletedCount, deletedProducts: productsResult.deletedCount }, null, 2));
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect();
});
