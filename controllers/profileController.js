const User = require('../models/User');


exports.getProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ message: 'Server error while fetching profile.' });
  }
};
exports.updateProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const { updates } = req.body;

    // Validate that updates is an object
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ message: 'Invalid updates payload.' });
    }

    // Filter out undefined values to prevent overwriting fields with undefined
    const validUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined)
    );

    // Validate specialty against known list if provided and role is Doctor
    if (validUpdates.specialty && req.body?.updates) {
      const SPECIALTIES = require('../utils/specialties');
      if (!SPECIALTIES.includes(validUpdates.specialty)) {
        return res.status(400).json({ message: 'Invalid specialty value.' });
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: validUpdates }, // Spread the updates object directly into $set
      { new: true, runValidators: true } // Ensure validators run and return the updated document
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.json({ message: 'Profile updated', user: updatedUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error updating profile.' });
  }
};
exports.updateActivationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { activationStatus } = req.body; // expected to be 'active' or 'declined'
    
    // Validate the activationStatus value.
    if (!['active', 'declined'].includes(activationStatus)) {
      return res.status(400).json({ message: 'Invalid activation status value.' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: { activationStatus } },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.json({ message: 'Activation status updated successfully.', user: updatedUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error updating activation status.' });
  }
};