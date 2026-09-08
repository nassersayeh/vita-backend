const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');
const {
  signupLimiters,
  usernameCheckLimiters,
  loginLimiters,
  forgotPasswordLimiters,
  resetCodeLimiters,
  phoneVerificationLimiters,
  resendVerificationLimiters,
} = require('../middleware/authRateLimiter');

router.post('/signup', ...signupLimiters, authController.signup);
router.post('/check-username', ...usernameCheckLimiters, authController.checkUsername);
router.post('/login', ...loginLimiters, authController.login);
router.put('/complete-mobile-profile', auth, authController.completeMobileProfile);
router.post('/forgot-password', ...forgotPasswordLimiters, authController.forgotPassword);
router.post('/verify-code', ...resetCodeLimiters, authController.verifyCode);

// Phone verification routes (for registration)
router.post('/verify-phone', ...phoneVerificationLimiters, authController.verifyPhone);
router.post('/resend-verification', ...resendVerificationLimiters, authController.resendVerificationCode);

// Accept Terms and Conditions
router.put('/:id/accept-terms', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    if (String(req.user._id) !== String(req.params.id) && !['Admin', 'Superadmin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
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
        termsAcceptedAt: user.termsAcceptedAt,
        termsVersion: user.termsVersion
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/:id/saved-card', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    if (String(req.user._id) !== String(req.params.id)) return res.status(403).json({ message: 'Forbidden' });
    const { cardNumber, cardHolder, expiryDate } = req.body;
    if (!/^\d{12,19}$/.test(String(cardNumber || '').replace(/\s/g, ''))) {
      return res.status(400).json({ message: 'Invalid card details' });
    }
    const cleanCard = cardNumber.replace(/\s/g, '');
    const masked = '*'.repeat(cleanCard.length - 4) + cleanCard.slice(-4);
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.savedCard) user.savedCard = {};
    user.savedCard.maskedNumber = masked;
    user.savedCard.cardHolder = cardHolder;
    user.savedCard.expiryDate = expiryDate;
    // Never store PAN or CVV. A payment-provider token must be used for charging.
    user.savedCard.cardToken = undefined;
    user.savedCard.savedAt = new Date();
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
