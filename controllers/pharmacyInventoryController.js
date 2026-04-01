const PharmacyInventory = require('../models/PharmacyInventory');
const Drug = require('../models/Drug');
const User = require('../models/User');

// Get all inventory items for a pharmacy
exports.getPharmacyInventory = async (req, res) => {
  try {
    const { pharmacyId } = req.params;

    // Allow patients to view any pharmacy's inventory for ordering
    // Only check authorization if the user is trying to access their own pharmacy's full details
    const userIsPharmacy = req.user._id.toString() === pharmacyId && req.user.role === 'pharmacy';
    if (userIsPharmacy) {
      // Pharmacy owners can only view their own inventory
      // (this is fine, they own it)
    }
    // Patients can view any pharmacy's inventory to place orders (no authorization check needed)

    const inventory = await PharmacyInventory.find({ 
      pharmacyId,
      isActive: true 
    })
      .populate('drugId', 'name genericName strength manufacturer barcode currentQuantity mainSupplier')
      .sort({ drugName: 1 });

    res.json(inventory);
  } catch (error) {
    console.error('Error fetching pharmacy inventory:', error);
    res.status(500).json({ message: 'Failed to fetch inventory', error: error.message });
  }
};

// Add a drug to pharmacy inventory
exports.addDrugToInventory = async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { drugId, quantity, price, costPrice, minimumStock, notes } = req.body;

    // Verify user is the pharmacy owner
    if (req.user._id.toString() !== pharmacyId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Validate inputs
    if (!drugId || quantity == null || price == null) {
      return res.status(400).json({ 
        message: 'drugId, quantity, and price are required' 
      });
    }

    if (quantity < 0 || price < 0) {
      return res.status(400).json({ 
        message: 'Quantity and price must be positive numbers' 
      });
    }

    // Check if drug exists
    const drug = await Drug.findById(drugId);
    if (!drug) {
      return res.status(404).json({ message: 'Drug not found' });
    }

    // Check if already in inventory
    const existing = await PharmacyInventory.findOne({ pharmacyId, drugId });
    if (existing) {
      return res.status(400).json({ 
        message: 'This drug is already in your inventory' 
      });
    }

    // Create inventory item
    const inventoryItem = new PharmacyInventory({
      pharmacyId,
      drugId,
      drugName: drug.name,
      drugGenericName: drug.genericName,
      quantity,
      price,
      costPrice: costPrice || null,
      minimumStock: minimumStock || 5,
      notes: notes || '',
      isAvailable: true
    });

    await inventoryItem.save();

    // Populate the drug details before returning
    await inventoryItem.populate('drugId', 'name genericName strength manufacturer barcode currentQuantity mainSupplier');

    res.status(201).json({
      message: 'Drug added to inventory',
      inventory: inventoryItem
    });
  } catch (error) {
    console.error('Error adding drug to inventory:', error);
    res.status(500).json({ message: 'Failed to add drug', error: error.message });
  }
};

// Update inventory item (quantity and/or price)
exports.updateInventoryItem = async (req, res) => {
  try {
    const { pharmacyId, drugId } = req.params;
    const { quantity, price, costPrice, minimumStock, isAvailable, notes } = req.body;

    // Verify user is the pharmacy owner
    if (req.user._id.toString() !== pharmacyId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Find inventory item
    const inventoryItem = await PharmacyInventory.findOne({ pharmacyId, drugId });
    if (!inventoryItem) {
      return res.status(404).json({ message: 'Inventory item not found' });
    }

    // Update fields
    if (quantity != null) {
      if (quantity < 0) {
        return res.status(400).json({ message: 'Quantity must be positive' });
      }
      inventoryItem.quantity = quantity;
    }

    if (price != null) {
      if (price < 0) {
        return res.status(400).json({ message: 'Price must be positive' });
      }
      inventoryItem.price = price;
    }

    if (costPrice != null) {
      inventoryItem.costPrice = costPrice;
    }

    if (minimumStock != null) {
      inventoryItem.minimumStock = minimumStock;
    }

    if (isAvailable != null) {
      inventoryItem.isAvailable = isAvailable;
    }

    if (notes != null) {
      inventoryItem.notes = notes;
    }

    inventoryItem.updatedAt = new Date();
    await inventoryItem.save();

    // Populate drug details
    await inventoryItem.populate('drugId', 'name genericName strength manufacturer barcode currentQuantity mainSupplier');

    res.json({
      message: 'Inventory item updated',
      inventory: inventoryItem
    });
  } catch (error) {
    console.error('Error updating inventory item:', error);
    res.status(500).json({ message: 'Failed to update item', error: error.message });
  }
};

// Remove drug from inventory (soft delete)
exports.removeFromInventory = async (req, res) => {
  try {
    const { pharmacyId, drugId } = req.params;

    // Verify user is the pharmacy owner
    if (req.user._id.toString() !== pharmacyId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const inventoryItem = await PharmacyInventory.findOne({ pharmacyId, drugId });
    if (!inventoryItem) {
      return res.status(404).json({ message: 'Inventory item not found' });
    }

    // Soft delete
    inventoryItem.isActive = false;
    await inventoryItem.save();

    res.json({ message: 'Item removed from inventory' });
  } catch (error) {
    console.error('Error removing from inventory:', error);
    res.status(500).json({ message: 'Failed to remove item', error: error.message });
  }
};

// Search and get available drugs to add (not yet in pharmacy inventory)
exports.getAvailableDrugsToAdd = async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { search } = req.query;

    // Verify user is the pharmacy owner
    if (req.user._id.toString() !== pharmacyId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Get drugs already in this pharmacy's inventory
    const existingDrugs = await PharmacyInventory.find({ 
      pharmacyId,
      isActive: true 
    }).select('drugId');
    
    const existingDrugIds = existingDrugs.map(item => item.drugId.toString());

    // Build query
    let query = { isActive: true };
    
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { name: searchRegex },
        { genericName: searchRegex },
        { manufacturer: searchRegex },
        { barcode: searchRegex }
      ];
    }

    // Get available drugs (not in inventory yet)
    const drugs = await Drug.find(query)
      .select('name genericName strength manufacturer barcode unitSellingPrice category dosageForm')
      .limit(50);

    // Filter out drugs already in inventory
    const availableDrugs = drugs.filter(drug => 
      !existingDrugIds.includes(drug._id.toString())
    );

    res.json(availableDrugs);
  } catch (error) {
    console.error('Error fetching available drugs:', error);
    res.status(500).json({ message: 'Failed to fetch drugs', error: error.message });
  }
};

// Get low stock items (for pharmacy restocking alerts)
exports.getLowStockItems = async (req, res) => {
  try {
    const { pharmacyId } = req.params;

    // Verify user is the pharmacy owner
    if (req.user._id.toString() !== pharmacyId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const lowStockItems = await PharmacyInventory.find({ 
      pharmacyId,
      isActive: true,
      $expr: { $lte: ['$quantity', '$minimumStock'] }
    })
      .populate('drugId', 'name genericName strength manufacturer')
      .sort({ quantity: 1 });

    res.json(lowStockItems);
  } catch (error) {
    console.error('Error fetching low stock items:', error);
    res.status(500).json({ message: 'Failed to fetch items', error: error.message });
  }
};

// Scan inventory by barcode
exports.scanByBarcode = async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { barcode } = req.query;
    if (!barcode) return res.status(400).json({ message: 'Barcode is required' });

    const items = await PharmacyInventory.find({ pharmacyId, isActive: true })
      .populate('drugId', 'name genericName strength manufacturer barcode unitSellingPrice');

    const found = items.find(i => i.drugId && i.drugId.barcode === barcode);
    if (!found) return res.status(404).json({ message: 'Product not found for this barcode' });

    res.json({ item: found });
  } catch (error) {
    console.error('Error scanning barcode:', error);
    res.status(500).json({ message: 'Error while scanning barcode' });
  }
};
