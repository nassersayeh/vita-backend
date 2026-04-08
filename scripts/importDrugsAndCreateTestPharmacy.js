/**
 * Import drugs from Excel file into Drug collection
 * and create a test pharmacy with 10 of each drug in inventory
 * 
 * Usage: node scripts/importDrugsAndCreateTestPharmacy.js
 */
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
const bcrypt = require('bcryptjs');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';
const EXCEL_PATH = path.join(__dirname, '../../vita-web/src/utils/استعلام الاصناف_28_8_2025  38 13.xls');

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const Drug = require('../models/Drug');
  const User = require('../models/User');
  const PharmacyInventory = require('../models/PharmacyInventory');

  // ========== Step 1: Read Excel file ==========
  console.log('\n📄 Reading Excel file...');
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);
  console.log(`   Found ${rows.length} rows`);

  // ========== Step 2: Import drugs ==========
  console.log('\n💊 Importing drugs into Drug collection...');
  
  // Clear existing drugs first
  const existingCount = await Drug.countDocuments();
  if (existingCount > 0) {
    console.log(`   Clearing ${existingCount} existing drugs...`);
    await Drug.deleteMany({});
  }

  const drugs = [];
  const batchSize = 500;
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const name = (row['اسم الصنف'] || '').trim();
    if (!name) { skipped++; continue; }

    const itemId = (row['رقم الصنف'] || '').toString().trim();
    const barcode = (row['بار كود'] || '').toString().trim();
    
    // Parse Excel date (serial number)
    let lastUpdateDate = null;
    if (row['التاريخ']) {
      try {
        if (typeof row['التاريخ'] === 'number') {
          // Excel serial date to JS date
          const excelEpoch = new Date(1899, 11, 30);
          lastUpdateDate = new Date(excelEpoch.getTime() + row['التاريخ'] * 86400000);
        } else {
          lastUpdateDate = new Date(row['التاريخ']);
        }
      } catch { lastUpdateDate = null; }
    }

    drugs.push({
      name,
      itemId: itemId || undefined,
      barcode: barcode || undefined,
      currentQuantity: row['ك.حالية'] || 0,
      mainSupplier: row['اسم المورد الرئيسي'] || '',
      lastPurchasePrice: row['اخر سعر شراء'] || 0,
      purchasePriceCurrency: row['عملة أخر سعر شراء'] || 'شيقل',
      unitSellingPrice: row['سعر بيع الوحدة الرئيسية'] || 0,
      lastUpdateDate,
      sellingPriceCurrency: row['عملة سعر بيع الوحدة الرئيسية'] || 'شيقل',
      wholesalePrice: row['سعر البيع جملة'] || 0,
      isFrozen: row['الصنف مجمد'] === 'Checked',
      warehouse: row['المستودع'] || 'Main Store',
      bulkWholesalePrice: row['سعر بيع جملة الجملة'] || 0,
      hasAlternatives: row['له بدائل'] === 'Checked',
      hasFollowups: row['له توابع'] === 'Checked',
      isActive: true,
    });

    // Insert in batches
    if (drugs.length >= batchSize) {
      await Drug.insertMany(drugs, { ordered: false }).catch(err => {
        console.log(`   ⚠️ Batch insert warning: ${err.message?.substring(0, 100)}`);
      });
      imported += drugs.length;
      process.stdout.write(`\r   Imported ${imported}/${rows.length} drugs...`);
      drugs.length = 0;
    }
  }

  // Insert remaining
  if (drugs.length > 0) {
    await Drug.insertMany(drugs, { ordered: false }).catch(err => {
      console.log(`\n   ⚠️ Batch insert warning: ${err.message?.substring(0, 100)}`);
    });
    imported += drugs.length;
  }

  const totalDrugs = await Drug.countDocuments();
  console.log(`\n   ✅ Total drugs in DB: ${totalDrugs} (skipped ${skipped} empty rows)`);

  // ========== Step 3: Create test pharmacy ==========
  console.log('\n🏥 Creating test pharmacy...');
  
  const testPharmacyMobile = '0599999999';
  let pharmacy = await User.findOne({ mobileNumber: testPharmacyMobile });
  
  if (pharmacy) {
    console.log(`   Test pharmacy already exists: ${pharmacy.fullName} (${pharmacy._id})`);
  } else {
    const hashedPassword = await bcrypt.hash('123456', 10);
    pharmacy = new User({
      fullName: 'صيدلية الاختبار',
      mobileNumber: testPharmacyMobile,
      password: hashedPassword,
      email: 'testpharmacy@vita.ps',
      country: 'Palestine',
      city: 'Ramallah',
      idNumber: '999999999',
      address: 'شارع الإرسال - رام الله',
      role: 'Pharmacy',
      activationStatus: 'active',
      isPaid: true,
      isPhoneVerified: true,
      trialEndDate: new Date('2030-12-31'),
    });
    await pharmacy.save();
    console.log(`   ✅ Created test pharmacy: ${pharmacy.fullName} (${pharmacy._id})`);
    console.log(`   📱 Mobile: ${testPharmacyMobile}`);
    console.log(`   🔑 Password: 123456`);
  }

  // ========== Step 4: Create inventory for test pharmacy ==========
  console.log('\n📦 Creating inventory for test pharmacy (10 of each drug)...');
  
  // Clear existing inventory for this pharmacy
  await PharmacyInventory.deleteMany({ pharmacyId: pharmacy._id });
  
  const allDrugs = await Drug.find({}).lean();
  console.log(`   Processing ${allDrugs.length} drugs...`);

  const inventoryBatch = [];
  let invImported = 0;

  for (const drug of allDrugs) {
    inventoryBatch.push({
      pharmacyId: pharmacy._id,
      drugId: drug._id,
      drugName: drug.name,
      drugGenericName: drug.genericName || '',
      quantity: 10,
      price: drug.unitSellingPrice || 0,
      costPrice: drug.lastPurchasePrice || 0,
      currency: 'ILS',
      isAvailable: true,
      minimumStock: 5,
      isActive: true,
    });

    if (inventoryBatch.length >= batchSize) {
      await PharmacyInventory.insertMany(inventoryBatch, { ordered: false }).catch(err => {
        console.log(`\n   ⚠️ Inventory batch warning: ${err.message?.substring(0, 100)}`);
      });
      invImported += inventoryBatch.length;
      process.stdout.write(`\r   Created ${invImported}/${allDrugs.length} inventory items...`);
      inventoryBatch.length = 0;
    }
  }

  if (inventoryBatch.length > 0) {
    await PharmacyInventory.insertMany(inventoryBatch, { ordered: false }).catch(err => {
      console.log(`\n   ⚠️ Inventory batch warning: ${err.message?.substring(0, 100)}`);
    });
    invImported += inventoryBatch.length;
  }

  const totalInventory = await PharmacyInventory.countDocuments({ pharmacyId: pharmacy._id });
  console.log(`\n   ✅ Total inventory items for test pharmacy: ${totalInventory}`);

  console.log('\n🎉 All done!');
  console.log('====================================');
  console.log(`📊 Drugs imported: ${totalDrugs}`);
  console.log(`🏥 Test Pharmacy: صيدلية الاختبار`);
  console.log(`📱 Login: ${testPharmacyMobile} / 123456`);
  console.log(`📦 Inventory: ${totalInventory} items (10 each)`);
  console.log('====================================');

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
