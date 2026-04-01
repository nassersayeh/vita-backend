const Drug = require('../models/Drug');
const PharmacyInventory = require('../models/PharmacyInventory');
const User = require('../models/User');

exports.getMedicationDetails = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: 'Missing medication id' });

    // Find medication
    const medication = await Drug.findById(id);
    if (!medication) return res.status(404).json({ success: false, message: 'Medication not found' });

    // Find pharmacies with this medication in inventory
    const inventoryItems = await PharmacyInventory.find({ drugId: id, isAvailable: true, isActive: true, quantity: { $gt: 0 } });
    const pharmacyIds = inventoryItems.map(item => item.pharmacyId);
    const pharmacies = await User.find({ _id: { $in: pharmacyIds }, role: 'Pharmacy' });

    // Map pharmacies with inventory info
    const pharmacyList = pharmacies.map(ph => {
      const inv = inventoryItems.find(item => item.pharmacyId.toString() === ph._id.toString());
      return {
        id: ph._id,
        name: ph.fullName,
        city: ph.city,
        address: ph.address,
        phone: ph.mobileNumber,
        price: inv?.price,
        quantity: inv?.quantity,
        currency: inv?.currency,
      };
    });

    // Build medication details
      const details = {
        id: medication._id,
        name: medication.name,
        genericName: medication.genericName,
        description: medication.description,
        category: medication.category,
        manufacturer: medication.manufacturer,
        dosageForm: medication.dosageForm,
        strength: medication.strength,
        activeIngredients: medication.activeIngredients,
        contraindications: medication.contraindications,
        sideEffects: medication.sideEffects,
        itemId: medication.itemId,
        barcode: medication.barcode,
        currentQuantity: medication.currentQuantity,
        mainSupplier: medication.mainSupplier,
        lastPurchasePrice: medication.lastPurchasePrice,
        purchasePriceCurrency: medication.purchasePriceCurrency,
        unitSellingPrice: medication.unitSellingPrice,
        lastUpdateDate: medication.lastUpdateDate,
        sellingPriceCurrency: medication.sellingPriceCurrency,
        wholesalePrice: medication.wholesalePrice,
        isFrozen: medication.isFrozen,
        warehouse: medication.warehouse,
        bulkWholesalePrice: medication.bulkWholesalePrice,
        hasAlternatives: medication.hasAlternatives,
        hasFollowups: medication.hasFollowups,
        isActive: medication.isActive,
        pharmacies: pharmacyList,
      };

    res.json({ success: true, data: details });
  } catch (err) {
    console.error('getMedicationDetails error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
