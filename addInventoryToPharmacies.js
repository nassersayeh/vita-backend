const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./models/User');
const Drug = require('./models/Drug');
const PharmacyInventory = require('./models/PharmacyInventory');

const MONGODB_URI = 'mongodb+srv://nassersayeh:pop1990@cluster0.rsdkh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const FIXED_QUANTITY = 10;

async function addInventoryToPharmacies() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get specific pharmacy
    const pharmacies = await User.find({ role: 'Pharmacy', email: 'wadahq@yahoo.com' });
    console.log(`Found ${pharmacies.length} pharmacies`);

    if (pharmacies.length === 0) {
      console.log('No pharmacies found. Exiting.');
      process.exit(0);
    }

    // Get all drugs
    const drugs = await Drug.find({});
    console.log(`Found ${drugs.length} drugs to add to each pharmacy\n`);

    if (drugs.length === 0) {
      console.log('No drugs found. Exiting.');
      process.exit(0);
    }

    let totalAdded = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const pharmacy of pharmacies) {
      console.log(`Processing pharmacy: ${pharmacy.name || pharmacy.email}`);
      console.log('─'.repeat(50));
      
      let pharmacyAdded = 0;
      let pharmacySkipped = 0;

      for (let i = 0; i < drugs.length; i++) {
        const drug = drugs[i];
        const progress = Math.round(((i + 1) / drugs.length) * 100);
        
        try {
          // Check if inventory entry already exists
          const existingInventory = await PharmacyInventory.findOne({
            pharmacyId: pharmacy._id,
            drugId: drug._id
          });

          if (existingInventory) {
            // Skip if already exists
            process.stdout.write(`\r[${progress}%] Skipping existing: ${drug.name.substring(0, 30).padEnd(30)}...`);
            pharmacySkipped++;
            totalSkipped++;
            continue;
          }

          // Create new inventory entry
          const inventoryEntry = new PharmacyInventory({
            pharmacyId: pharmacy._id,
            drugId: drug._id,
            drugName: drug.name,
            drugGenericName: drug.genericName || '',
            quantity: FIXED_QUANTITY,
            price: drug.unitSellingPrice || drug.lastPurchasePrice || 10,
            costPrice: drug.lastPurchasePrice || 0,
            currency: 'ILS',
            isAvailable: true,
            minimumStock: 5,
            lastRestockDate: new Date(),
            isActive: true
          });

          await inventoryEntry.save();
          process.stdout.write(`\r[${progress}%] Added: ${drug.name.substring(0, 40).padEnd(40)}...`);
          pharmacyAdded++;
          totalAdded++;
          
        } catch (err) {
          // Skip all errors silently
          process.stdout.write(`\r[${progress}%] Error (skipping): ${drug.name.substring(0, 30).padEnd(30)}...`);
          totalErrors++;
          continue;
        }
      }

      console.log(`\n\n✓ Pharmacy complete - Added: ${pharmacyAdded}, Skipped: ${pharmacySkipped}`);
    }

    console.log('\n' + '═'.repeat(50));
    console.log('SUMMARY');
    console.log('═'.repeat(50));
    console.log(`Total pharmacies processed: ${pharmacies.length}`);
    console.log(`Total drugs in database: ${drugs.length}`);
    console.log(`Total new inventory entries added: ${totalAdded}`);
    console.log(`Total skipped (already exist): ${totalSkipped}`);
    console.log(`Total errors (skipped): ${totalErrors}`);
    console.log('═'.repeat(50));

    console.log('\n✓ Done!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addInventoryToPharmacies();
