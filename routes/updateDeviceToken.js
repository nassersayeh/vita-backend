// routes/users.js or create a dedicated file updateDeviceToken.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');

router.put('/update-device-token/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { deviceToken } = req.body;
    if (!deviceToken) {
      return res.status(400).json({ message: 'Device token is required' });
    }
    const user = await User.findByIdAndUpdate(
      userId,
      { deviceToken, tokenUpdatedAt: new Date() },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ message: 'Device token updated successfully', user });
  } catch (error) {
    console.error('Error updating device token:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
