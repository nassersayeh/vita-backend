const express = require('express');
const router = express.Router();
const PharmacySupplier = require('../models/PharmacySupplier');
const auth = require('../middleware/auth');

// Get all suppliers for a pharmacy
router.get('/pharmacy/:pharmacyId', auth, async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    
    // Verify the user is the pharmacy owner or an employee with permission
    if (req.user._id.toString() !== pharmacyId && req.user.role !== 'admin') {
      // Could also check if user is a pharmacy employee with canViewSuppliers permission
      return res.status(403).json({ message: 'Not authorized to view suppliers' });
    }
    
    const suppliers = await PharmacySupplier.find({ pharmacyId, isActive: true })
      .sort({ createdAt: -1 });
    
    res.json({ suppliers });
  } catch (error) {
    console.error('Error fetching pharmacy suppliers:', error);
    res.status(500).json({ message: 'Failed to fetch suppliers', error: error.message });
  }
});

// Get a single supplier by ID
router.get('/:supplierId', auth, async (req, res) => {
  try {
    const { supplierId } = req.params;
    
    const supplier = await PharmacySupplier.findById(supplierId);
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    
    // Verify the user is the pharmacy owner
    if (req.user._id.toString() !== supplier.pharmacyId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to view this supplier' });
    }
    
    res.json({ supplier });
  } catch (error) {
    console.error('Error fetching supplier:', error);
    res.status(500).json({ message: 'Failed to fetch supplier', error: error.message });
  }
});

// Create a new supplier for a pharmacy
router.post('/pharmacy/:pharmacyId', auth, async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { name, description, contactPerson, email, phone, address, products, notes } = req.body;
    
    // Verify the user is the pharmacy owner
    if (req.user._id.toString() !== pharmacyId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to add suppliers' });
    }
    
    // Validate required fields
    if (!name || !description) {
      return res.status(400).json({ message: 'Name and description are required' });
    }
    
    // Create the supplier
    const supplier = new PharmacySupplier({
      pharmacyId,
      name,
      description,
      contactPerson,
      email: email ? email.toLowerCase() : undefined,
      phone,
      address,
      products: products || [],
      notes
    });
    await supplier.save();
    
    res.status(201).json({ 
      message: 'Supplier created successfully',
      supplier
    });
  } catch (error) {
    console.error('Error creating pharmacy supplier:', error);
    res.status(500).json({ message: 'Failed to create supplier', error: error.message });
  }
});

// Update a supplier
router.put('/:supplierId', auth, async (req, res) => {
  try {
    const { supplierId } = req.params;
    const { name, description, contactPerson, email, phone, address, products, notes } = req.body;
    
    const supplier = await PharmacySupplier.findById(supplierId);
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    
    // Verify the user is the pharmacy owner
    if (req.user._id.toString() !== supplier.pharmacyId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to update this supplier' });
    }
    
    // Update fields
    if (name) supplier.name = name;
    if (description) supplier.description = description;
    if (contactPerson !== undefined) supplier.contactPerson = contactPerson;
    if (email !== undefined) supplier.email = email ? email.toLowerCase() : '';
    if (phone !== undefined) supplier.phone = phone;
    if (address !== undefined) supplier.address = address;
    if (products) supplier.products = products;
    if (notes !== undefined) supplier.notes = notes;
    
    await supplier.save();
    
    res.json({ 
      message: 'Supplier updated successfully',
      supplier
    });
  } catch (error) {
    console.error('Error updating pharmacy supplier:', error);
    res.status(500).json({ message: 'Failed to update supplier', error: error.message });
  }
});

// Delete a supplier (soft delete)
router.delete('/:supplierId', auth, async (req, res) => {
  try {
    const { supplierId } = req.params;
    
    const supplier = await PharmacySupplier.findById(supplierId);
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    
    // Verify the user is the pharmacy owner
    if (req.user._id.toString() !== supplier.pharmacyId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to delete this supplier' });
    }
    
    supplier.isActive = false;
    await supplier.save();
    
    res.json({ message: 'Supplier deleted successfully' });
  } catch (error) {
    console.error('Error deleting pharmacy supplier:', error);
    res.status(500).json({ message: 'Failed to delete supplier', error: error.message });
  }
});

module.exports = router;
