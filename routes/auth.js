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

module.exports = router;
