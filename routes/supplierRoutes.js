const express = require('express');
const router = express.Router();
const Supplier = require('../models/Supplier');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');

// Middleware to verify admin access
const requireAdmin = async (req, res, next) => {
  if (req.user.role !== 'Superadmin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Get all suppliers for a doctor
router.get('/doctor/:doctorId', authMiddleware, async (req, res) => {
  try {
    const { doctorId } = req.params;

    // Check if user is the doctor, clinic owner, or an admin
    if (req.user.role !== 'Superadmin' && req.user.role !== 'Clinic' && req.user._id.toString() !== doctorId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const suppliers = await Supplier.find({ 
      createdBy: doctorId,
      isActive: true 
    })
      .populate('createdBy', 'fullName')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      suppliers: suppliers.map(supplier => ({
        _id: supplier._id,
        name: supplier.name,
        description: supplier.description,
        contactPerson: supplier.contactPerson,
        email: supplier.email,
        phone: supplier.phone,
        address: supplier.address,
        products: supplier.products,
        notes: supplier.notes,
        createdBy: supplier.createdBy,
        createdAt: supplier.createdAt
      }))
    });
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({ message: 'Failed to fetch suppliers', error: error.message });
  }
});

// Create new supplier for a doctor
router.post('/doctor/:doctorId', authMiddleware, [
  body('name').isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('description').isLength({ min: 10, max: 500 }).withMessage('Description must be 10-500 characters')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { doctorId } = req.params;

    // Check if user is the doctor, clinic owner, or an admin
    if (req.user.role !== 'Superadmin' && req.user.role !== 'Clinic' && req.user._id.toString() !== doctorId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { name, description, contactPerson, email, phone, address, products, notes } = req.body;

    const newSupplier = new Supplier({
      name,
      description,
      contactPerson,
      email,
      phone,
      address,
      products: products || [],
      notes,
      createdBy: doctorId
    });

    await newSupplier.save();

    const populatedSupplier = await Supplier.findById(newSupplier._id)
      .populate('createdBy', 'fullName');

    res.status(201).json({
      success: true,
      message: 'Supplier created successfully',
      supplier: {
        _id: populatedSupplier._id,
        name: populatedSupplier.name,
        description: populatedSupplier.description,
        contactPerson: populatedSupplier.contactPerson,
        email: populatedSupplier.email,
        phone: populatedSupplier.phone,
        address: populatedSupplier.address,
        products: populatedSupplier.products,
        notes: populatedSupplier.notes,
        createdBy: populatedSupplier.createdBy,
        createdAt: populatedSupplier.createdAt
      }
    });
  } catch (error) {
    console.error('Error creating supplier:', error);
    if (error.code === 11000) {
      res.status(400).json({ message: 'Supplier with this name already exists' });
    } else {
      res.status(500).json({ message: 'Failed to create supplier', error: error.message });
    }
  }
});

// Update supplier
router.put('/:supplierId', authMiddleware, [
  body('name').optional().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('description').optional().isLength({ min: 10, max: 500 }).withMessage('Description must be 10-500 characters')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { supplierId } = req.params;

    // Find supplier and check ownership
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    // Check if user owns this supplier or is admin/clinic
    if (req.user.role !== 'Superadmin' && req.user.role !== 'Clinic' && supplier.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updateData = req.body;
    const updatedSupplier = await Supplier.findByIdAndUpdate(
      supplierId,
      updateData,
      { new: true }
    ).populate('createdBy', 'fullName');

    res.status(200).json({
      success: true,
      message: 'Supplier updated successfully',
      supplier: {
        _id: updatedSupplier._id,
        name: updatedSupplier.name,
        description: updatedSupplier.description,
        contactPerson: updatedSupplier.contactPerson,
        email: updatedSupplier.email,
        phone: updatedSupplier.phone,
        address: updatedSupplier.address,
        products: updatedSupplier.products,
        notes: updatedSupplier.notes,
        createdBy: updatedSupplier.createdBy,
        createdAt: updatedSupplier.createdAt
      }
    });
  } catch (error) {
    console.error('Error updating supplier:', error);
    res.status(500).json({ message: 'Failed to update supplier', error: error.message });
  }
});

// Delete supplier (soft delete)
router.delete('/:supplierId', authMiddleware, async (req, res) => {
  try {
    const { supplierId } = req.params;

    // Find supplier and check ownership
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    // Check if user owns this supplier or is admin/clinic
    if (req.user.role !== 'Superadmin' && req.user.role !== 'Clinic' && supplier.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updatedSupplier = await Supplier.findByIdAndUpdate(
      supplierId,
      { isActive: false },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Supplier deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting supplier:', error);
    res.status(500).json({ message: 'Failed to delete supplier', error: error.message });
  }
});

// Get single supplier
router.get('/:supplierId', authMiddleware, async (req, res) => {
  try {
    const { supplierId } = req.params;

    const supplier = await Supplier.findById(supplierId)
      .populate('createdBy', 'fullName');

    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    // Check if user owns this supplier or is admin/clinic
    if (req.user.role !== 'Superadmin' && req.user.role !== 'Clinic' && supplier.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.status(200).json({
      success: true,
      supplier: {
        _id: supplier._id,
        name: supplier.name,
        description: supplier.description,
        contactPerson: supplier.contactPerson,
        email: supplier.email,
        phone: supplier.phone,
        address: supplier.address,
        products: supplier.products,
        notes: supplier.notes,
        createdBy: supplier.createdBy,
        createdAt: supplier.createdAt
      }
    });
  } catch (error) {
    console.error('Error fetching supplier:', error);
    res.status(500).json({ message: 'Failed to fetch supplier', error: error.message });
  }
});

module.exports = router;