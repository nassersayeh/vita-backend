const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');

// All routes require authentication
router.use(auth);

// GET /api/addresses - Get current user's delivery addresses
router.get('/', async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('deliveryAddresses');
    res.json(user?.deliveryAddresses || []);
  } catch (error) {
    console.error('Error fetching addresses:', error);
    res.status(500).json({ message: 'Failed to fetch addresses' });
  }
});

// POST /api/addresses - Add a new delivery address
router.post('/', async (req, res) => {
  try {
    const { label, city, street, building, floor, apartment, phone, notes, isDefault } = req.body;

    if (!label || !city || !street) {
      return res.status(400).json({ message: 'Label, city, and street are required' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // If this is set as default, unset all others
    if (isDefault) {
      user.deliveryAddresses.forEach(addr => { addr.isDefault = false; });
    }

    // If it's the first address, make it default
    const makeDefault = isDefault || user.deliveryAddresses.length === 0;

    user.deliveryAddresses.push({
      label, city, street, building, floor, apartment, phone, notes,
      isDefault: makeDefault,
    });

    await user.save();
    res.status(201).json(user.deliveryAddresses);
  } catch (error) {
    console.error('Error adding address:', error);
    res.status(500).json({ message: 'Failed to add address' });
  }
});

// PUT /api/addresses/:addressId - Update an address
router.put('/:addressId', async (req, res) => {
  try {
    const { addressId } = req.params;
    const { label, city, street, building, floor, apartment, phone, notes, isDefault } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const address = user.deliveryAddresses.id(addressId);
    if (!address) return res.status(404).json({ message: 'Address not found' });

    // If setting as default, unset others
    if (isDefault) {
      user.deliveryAddresses.forEach(addr => { addr.isDefault = false; });
    }

    if (label) address.label = label;
    if (city) address.city = city;
    if (street) address.street = street;
    if (building !== undefined) address.building = building;
    if (floor !== undefined) address.floor = floor;
    if (apartment !== undefined) address.apartment = apartment;
    if (phone !== undefined) address.phone = phone;
    if (notes !== undefined) address.notes = notes;
    if (isDefault !== undefined) address.isDefault = isDefault;

    await user.save();
    res.json(user.deliveryAddresses);
  } catch (error) {
    console.error('Error updating address:', error);
    res.status(500).json({ message: 'Failed to update address' });
  }
});

// DELETE /api/addresses/:addressId - Delete an address
router.delete('/:addressId', async (req, res) => {
  try {
    const { addressId } = req.params;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const address = user.deliveryAddresses.id(addressId);
    if (!address) return res.status(404).json({ message: 'Address not found' });

    const wasDefault = address.isDefault;
    user.deliveryAddresses.pull(addressId);

    // If we deleted the default, make the first remaining address default
    if (wasDefault && user.deliveryAddresses.length > 0) {
      user.deliveryAddresses[0].isDefault = true;
    }

    await user.save();
    res.json(user.deliveryAddresses);
  } catch (error) {
    console.error('Error deleting address:', error);
    res.status(500).json({ message: 'Failed to delete address' });
  }
});

module.exports = router;
