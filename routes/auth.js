const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/verify-code', authController.verifyCode);

// Phone verification routes (for registration)
router.post('/verify-phone', authController.verifyPhone);
router.post('/resend-verification', authController.resendVerificationCode);

// Accept Terms and Conditions
router.put('/:id/accept-terms', async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    user.termsAccepted = true;
    user.termsAcceptedAt = new Date();
    user.termsVersion = '1.0';
    await user.save();
    
    res.json({
      success: true,
      message: 'Terms and Conditions accepted',
      user: {
        _id: user._id,
        termsAccepted: user.termsAccepted,
        termsAcceptedAt: user.termsAcceptedAt
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id/saved-card', async (req, res) => {
  try {
    const User = require('../models/User');
    const { cardNumber, cardHolder, expiryDate, cvv } = req.body;
    const cleanCard = cardNumber.replace(/\s/g, '');
    const masked = '*'.repeat(cleanCard.length - 4) + cleanCard.slice(-4);
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.savedCard) user.savedCard = {};
    user.savedCard.maskedNumber = masked;
    user.savedCard.cardHolder = cardHolder;
    user.savedCard.expiryDate = expiryDate;
    user.savedCard.cardToken = Buffer.from(cleanCard + '|' + cvv + '|' + expiryDate).toString('base64');
    user.savedCard.savedAt = new Date();
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
