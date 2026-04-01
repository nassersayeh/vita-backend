const express = require('express');
const router = express.Router();
const {
  getReferralStats,
  getReferralHistory,
  getReferralCode,
  useReferralCode,
  awardReferralPoints
} = require('../controllers/referralController');

// Protect all routes with auth middleware

// Get referral stats
router.get('/stats', getReferralStats);

// Get referral history
router.get('/history', getReferralHistory);

// Get or generate referral code
router.get('/code', getReferralCode);

// Use a referral code
router.post('/use', useReferralCode);

// Award referral points for actions
router.post('/award', awardReferralPoints);

module.exports = router;