/**
 * Utility: Auto-assign default inventory (10 of each drug) to a pharmacy
 * Used when a new pharmacy is approved or created
 */
const Drug = require('../models/Drug');
const PharmacyInventory = require('../models/PharmacyInventory');

const DEFAULT_QUANTITY = 10;
const BATCH_SIZE = 500;

/**
 * Assign all drugs in the Drug collection as inventory for a pharmacy
 * @param {string} pharmacyId - The pharmacy user's _id
 * @returns {Promise<number>} - Number of inventory items created
 */
async function assignDefaultInventory(pharmacyId) {
  try {
    // Check if pharmacy already has inventory
    const existingCount = await PharmacyInventory.countDocuments({ pharmacyId });
    if (existingCount > 0) {
      console.log(`Pharmacy ${pharmacyId} already has ${existingCount} inventory items, skipping auto-assign.`);
      return existingCount;
    }

    const allDrugs = await Drug.find({ isActive: true }).lean();
    if (allDrugs.length === 0) {
      console.log('No drugs found in Drug collection, skipping inventory assignment.');
      return 0;
    }

    let created = 0;
    const batch = [];

    for (const drug of allDrugs) {
      batch.push({
        pharmacyId,
        drugId: drug._id,
        drugName: drug.name,
        drugGenericName: drug.genericName || '',
        quantity: DEFAULT_QUANTITY,
        price: drug.unitSellingPrice || 0,
        costPrice: drug.lastPurchasePrice || 0,
        currency: 'ILS',
        isAvailable: true,
        minimumStock: 5,
        isActive: true,
      });

      if (batch.length >= BATCH_SIZE) {
        await PharmacyInventory.insertMany(batch, { ordered: false }).catch(err => {
          console.error(`Inventory batch insert error for pharmacy ${pharmacyId}:`, err.message?.substring(0, 200));
        });
        created += batch.length;
        batch.length = 0;
      }
    }

    if (batch.length > 0) {
      await PharmacyInventory.insertMany(batch, { ordered: false }).catch(err => {
        console.error(`Inventory batch insert error for pharmacy ${pharmacyId}:`, err.message?.substring(0, 200));
      });
      created += batch.length;
    }

    console.log(`✅ Assigned ${created} inventory items (qty ${DEFAULT_QUANTITY} each) to pharmacy ${pharmacyId}`);
    return created;
  } catch (error) {
    console.error(`Error assigning default inventory to pharmacy ${pharmacyId}:`, error.message);
    return 0;
  }
}

module.exports = { assignDefaultInventory };
