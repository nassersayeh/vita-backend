const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// Get pending approvals
router.get('/pending-approvals', adminController.getPendingApprovals);

// Approve or reject user
router.put('/approve-user/:userId', adminController.approveUser);

// Get all users with filtering
router.get('/users', adminController.getAllUsers);

// Send targeted notification
router.post('/notifications', adminController.sendNotification);

// Get dashboard analytics
router.get('/analytics', adminController.getDashboardAnalytics);

// Get admin stats (new route)
router.get('/stats', adminController.getDashboardAnalytics);

// Get notification history
router.get('/notifications/history', adminController.getNotificationHistory);

// Delete user
router.delete('/users/:userId', adminController.deleteUser);

// Get user counts by role
router.get('/user-stats', adminController.getUserStats);

// List users with trial status (active, ended, paid/unpaid)
router.get('/trials', adminController.getTrialUsers);

// Extend trial for a user
router.put('/user/:id/trial', adminController.extendTrial);

// Update payment status for a user
router.put('/user/:id/payment', adminController.updatePaymentStatus);


// Create a new user (admin only)
router.post('/users/create', adminController.createUser);

// Search users for gift points modal
router.get('/users/search-for-gift', adminController.searchUsersForGift);

// Get user by ID
router.get('/users/:userId', adminController.getUserById);

// Update user data
router.put('/users/:userId', adminController.updateUser);

// Get revenue by month
router.get('/revenue/:year/:month', adminController.getRevenueByMonth);

// Gift points to users
router.post('/gift-points', adminController.giftPoints);

// ======= Insurance Payments (Pharmacy claims to admin) =======
router.get('/insurance-payments', async (req, res) => {
  try {
    const InsuranceClaim = require('../models/InsuranceClaim');
    // Group by pharmacy - only claims where service fee was actually paid (via card)
    const grouped = await InsuranceClaim.aggregate([
      { $match: { servicePaymentStatus: 'paid' } },
      {
        $group: {
          _id: '$pharmacyId',
          pharmacyName: { $first: '$pharmacyName' },
          totalClaims: { $sum: 1 },
          totalClaimsValue: { $sum: '$claimsValue' },
          totalServiceFee: { $sum: '$serviceFee' },
          totalPaidServiceFee: { $sum: '$serviceFee' },
          paidClaims: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
          pendingClaims: { $sum: { $cond: [{ $ne: ['$status', 'paid'] }, 1, 0] } },
        }
      },
      { $sort: { totalPaidServiceFee: -1 } }
    ]);
    res.json({ pharmacies: grouped });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.get('/insurance-payments/:pharmacyId', async (req, res) => {
  try {
    const InsuranceClaim = require('../models/InsuranceClaim');
    const mongoose = require('mongoose');
    const claims = await InsuranceClaim.find({
      pharmacyId: new mongoose.Types.ObjectId(req.params.pharmacyId),
      servicePaymentStatus: 'paid',
    }).sort({ createdAt: -1 });
    res.json({ claims });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ======= Subscriptions (Platform + Vita AI ChatBot) =======
router.get('/subscriptions', async (req, res) => {
  try {
    const User = require('../models/User');
    const now = new Date();

    // Platform subscriptions
    const platformSubs = await User.find({
      role: { $in: ['Pharmacy', 'Doctor'] },
      $or: [
        { subscriptionEndDate: { $ne: null } },
        { isPaid: true },
        { hasAcceptedOffer: true },
      ]
    }).select('name fullName clinicName role phone city subscriptionEndDate subscriptionPlanUnit subscriptionPlanValue lastPaymentAmount lastPaymentAt isPaid hasAcceptedOffer offerAcceptedAt trialEndDate').lean();

    // Vita AI subscriptions
    const aiSubs = await User.find({
      'vitatAI.isSubscribed': true,
    }).select('name fullName clinicName role phone city vitatAI').lean();

    // Vita AI trial users
    const aiTrials = await User.find({
      'vitatAI.hasAcceptedTrial': true,
      'vitatAI.isSubscribed': { $ne: true },
    }).select('name fullName clinicName role phone city vitatAI').lean();

    res.json({ platformSubs, aiSubs, aiTrials });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Insurance companies and oversight accounts for admin
router.get('/insurance-accounts', async (req, res) => {
  try {
    const InsuranceCompany = require('../models/InsuranceCompany');
    const OversightAccount = require('../models/OversightAccount');
    const [companies, oversight] = await Promise.all([
      InsuranceCompany.find({}).select('-password').sort({ createdAt: -1 }),
      OversightAccount.find({}).select('-password').sort({ createdAt: -1 }),
    ]);
    res.json({ companies, oversight });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.delete('/insurance-accounts/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    if (type === 'company') {
      const InsuranceCompany = require('../models/InsuranceCompany');
      await InsuranceCompany.findByIdAndDelete(id);
    } else {
      const OversightAccount = require('../models/OversightAccount');
      await OversightAccount.findByIdAndDelete(id);
    }
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;