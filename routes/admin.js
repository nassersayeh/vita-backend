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