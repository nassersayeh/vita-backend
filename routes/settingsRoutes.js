const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const auth = require('../middleware/auth');

// Contact Us (public route)
router.post('/contact-us', settingsController.contactUs);

// Protected routes (require authentication)
// Change Password
router.post('/change-password', auth, settingsController.changePassword);

// Two-Factor Authentication
router.get('/2fa/status', auth, settingsController.get2FAStatus);
router.post('/2fa/enable', auth, settingsController.enable2FA);
router.post('/2fa/verify', auth, settingsController.verify2FA);
router.post('/2fa/disable', auth, settingsController.disable2FA);

// Data Export
router.post('/export-data', auth, settingsController.exportUserData);

// Delete Account
router.post('/delete-account', auth, settingsController.deleteAccountRequest);

// Language Preference
router.get('/language', auth, settingsController.getLanguage);
router.post('/language', auth, settingsController.updateLanguage);

module.exports = router;
