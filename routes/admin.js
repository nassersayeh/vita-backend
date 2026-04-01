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

module.exports = router;