const PharmacyInventory = require('../models/PharmacyInventory');
const Drug = require('../models/Drug');
const User = require('../models/User');

// Get inventory items for a pharmacy (with pagination and search)
exports.getPharmacyInventory = async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const fetchAll = req.query.all === 'true';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = fetchAll ? 0 : Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const search = (req.query.search || '').trim();
    const lowStockOnly = req.query.lowStock === 'true';
    const skip = fetchAll ? 0 : (page - 1) * limit;

    const filter = { pharmacyId, isActive: true };

    if (search.length >= 2) {
      const searchRegex = new RegExp(search, 'i');
      filter.$or = [
        { drugName: searchRegex },
        { drugGenericName: searchRegex },
      ];
    }

    if (lowStockOnly) {
      filter.$expr = { $lte: ['$quantity', '$minimumStock'] };
    }

    let query = PharmacyInventory.find(filter)
      .select('drugId drugName drugGenericName quantity price costPrice minimumStock isAvailable notes')
      .populate('drugId', 'name genericName strength dosageForm manufacturer barcode description isCustom ownerPharmacyId')
      .sort({ drugName: 1 })
      .lean();

    if (!fetchAll) {
      query = query.skip(skip).limit(limit);
    }

    const [inventory, total] = await Promise.all([
      query,
      PharmacyInventory.countDocuments(filter)
    ]);

    res.json({
      items: inventory,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
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
      priceSource: 'manual',
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

// Add or link a shared catalog medicine and save this pharmacy's stock separately.
exports.addManualDrugToInventory = async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    if (req.user._id.toString() !== pharmacyId) return res.status(403).json({ message: 'Not authorized' });
    const { quantity, price, costPrice, minimumStock } = req.body;
    const valid = value => value !== null && value !== undefined && String(value).trim() !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value)) && Number(value) >= 0;
    if (!valid(quantity) || !Number.isInteger(Number(quantity)) || !valid(price) || (costPrice != null && costPrice !== '' && !valid(costPrice)) || (minimumStock != null && !valid(minimumStock))) return res.status(400).json({ message: 'Valid quantity and selling price are required' });
    const resolveDrug = require('../utils/sharedDrugCatalog').createCatalogService(Drug, require('../models/DrugCatalogLock'));
    const { drug, created, linked } = await resolveDrug(req.body);
    const fields = { drugName: drug.name, drugGenericName: drug.genericName, quantity: Number(quantity), price: Number(price), priceSource: 'manual', minimumStock: minimumStock == null ? 5 : Number(minimumStock), isAvailable: true, isActive: true };
    if (costPrice != null && costPrice !== '') fields.costPrice = Number(costPrice);
    // Quantity is an absolute stock count, making retries safe (never double-restock).
    let inventory;
    try { inventory = await PharmacyInventory.findOneAndUpdate({ pharmacyId, drugId: drug._id }, { $set: fields }, { upsert: true, new: true, runValidators: true }); }
    catch (error) { if (error.code !== 11000) throw error; inventory = await PharmacyInventory.findOneAndUpdate({ pharmacyId, drugId: drug._id }, { $set: fields }, { new: true, runValidators: true }); }
    await inventory.populate('drugId', 'name genericName strength dosageForm manufacturer barcode unitSellingPrice');
    res.status(201).json({ message: 'Medicine saved in catalog and inventory', inventory, drug, created, linked });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.status ? error.message : 'Failed to save medicine' });
  }
};

// Update inventory item (quantity and/or price)
exports.updateInventoryItem = async (req, res) => {
  try {
    const { pharmacyId, drugId } = req.params;
    const { quantity, price, costPrice, minimumStock, isAvailable, notes, name, genericName, strength, dosageForm, manufacturer, barcode, description } = req.body;

    // Verify user is the pharmacy owner
    if (req.user._id.toString() !== pharmacyId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Find inventory item
    const inventoryItem = await PharmacyInventory.findOne({ pharmacyId, drugId });
    if (!inventoryItem) {
      return res.status(404).json({ message: 'Inventory item not found' });
    }
    const drug = await Drug.findById(drugId);
    if (drug?.isCustom && drug.ownerPharmacyId?.toString() === pharmacyId) {
      const metadata = { name, genericName, strength, dosageForm, manufacturer, barcode, description };
      if (Object.entries(metadata).some(([key, value]) => value !== undefined && value !== drug[key]) && await require('../models/ControlledDrug').exists({ drugId, approved: true })) return res.status(403).json({ message: 'لا يمكن تعديل بيانات دواء معتمد للكونترول.' });
      Object.assign(drug, { name, genericName, strength, dosageForm, manufacturer, barcode, description });
      await drug.save();
      inventoryItem.drugName = name || inventoryItem.drugName;
      inventoryItem.drugGenericName = genericName || inventoryItem.drugGenericName;
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
      inventoryItem.priceSource = 'manual';
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
    }).select('drugId').lean();
    
    const existingDrugIds = existingDrugs.map(item => item.drugId);

    // Build query - exclude drugs already in inventory
    let query = { isActive: true, _id: { $nin: existingDrugIds } };
    
    if (search && search.trim().length >= 2) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { name: searchRegex },
        { genericName: searchRegex },
        { manufacturer: searchRegex },
        { barcode: searchRegex }
      ];
    } else {
      return res.json([]);
    }

    // Get available drugs directly from DB
    const availableDrugs = await Drug.find(query)
      .select('name genericName strength manufacturer barcode unitSellingPrice category dosageForm')
      .limit(30)
      .lean();

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
