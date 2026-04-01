// Updated User Routes (routes/user.js)
// Added routes for connected doctors and health profile update

const express = require('express');
const router = express.Router();
const User = require('../models/User');

// GET users by role (e.g., /users/role/Doctor)
router.get('/role/:role', async (req, res) => {
  try {
    const { role } = req.params;
    const { city, search } = req.query;
    
    let filter = { role };
    
    if (city) {
      filter.city = city;
    }
    
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } }
      ];
    }
    
    const users = await User.find(filter).select('-password'); // Exclude sensitive fields
    if (!users || users.length === 0) {
      return res.status(404).json({ message: `No users found for role: ${role}` });
    }
    res.json(users);
  } catch (err) {
    console.error('Error fetching users by role:', err);
    res.status(500).json({ message: 'Server error fetching users by role' });
  }
});

// GET single user by ID
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findOne({ _id: req.params.id }).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching user details' });
  }
});

// UPDATE user profile (mobile app)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, email, mobileNumber, address, city, nationalId, dateOfBirth } = req.body;
    
    // Only allow updating specific fields
    const allowedUpdates = {};
    if (fullName) allowedUpdates.fullName = fullName;
    if (email) allowedUpdates.email = email;
    if (mobileNumber) allowedUpdates.mobileNumber = mobileNumber;
    if (address) allowedUpdates.address = address;
    if (city) allowedUpdates.city = city;
    if (nationalId) allowedUpdates.nationalId = nationalId;
    if (dateOfBirth) allowedUpdates.dateOfBirth = dateOfBirth;
    
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: allowedUpdates },
      { new: true, runValidators: true }
    ).select('-password');
    
    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(updatedUser);
  } catch (err) {
    console.error('Error updating user profile:', err);
    res.status(500).json({ message: 'Server error updating user profile' });
  }
});

// NEW: GET connected doctors for a patient
router.get('/connected-doctors/:patientId', async (req, res) => {
  try {
    const { patientId } = req.params;
    const doctors = await User.find({
      role: 'Doctor',
      patients: patientId
    }).select('-password');
    res.json(doctors);
  } catch (err) {
    console.error('Error fetching connected doctors:', err);
    res.status(500).json({ message: 'Server error fetching connected doctors' });
  }
});

// NEW: UPDATE health profile
router.put('/:id/health-profile', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');
    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(updatedUser);
  } catch (err) {
    console.error('Error updating health profile:', err);
    res.status(500).json({ message: 'Server error updating health profile' });
  }
});

module.exports = router;