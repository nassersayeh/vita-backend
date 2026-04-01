const express = require('express');
const router = express.Router();
const User = require('../models/User');

// PUT /api/settings/:userId/settings
router.put('/:userId/settings', async (req, res) => {
  try {
    const { userId } = req.params;
    const { language } = req.body;
    if (!language) {
      return res.status(400).json({ message: 'Language is required.' });
    }
    // Update the user's language setting (assuming your User model has a "language" field)
    const user = await User.findByIdAndUpdate(userId, { language }, { new: true });
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }
    res.json({ message: 'Language updated successfully.', user });
  } catch (error) {
    console.error("Error updating user settings:", error);
    res.status(500).json({ message: 'Server error while updating settings.' });
  }
});

module.exports = router;
