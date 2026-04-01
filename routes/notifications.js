const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const AdminNotification = require('../models/AdminNotification');

// Get unread notification count - MUST be before /:userId route
router.get('/unread-count', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;

    const count = await AdminNotification.countDocuments({
      $or: [
        { targetUsers: userId },
        { targetRoles: userRole },
        { targetUsers: { $exists: false }, targetRoles: { $exists: false } }
      ],
      readBy: { $ne: userId }
    });

    res.json({ count });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark all notifications as read - MUST be before /:notificationId route
router.put('/mark-all-read', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;

    // Update all notifications that target this user
    await AdminNotification.updateMany(
      {
        $or: [
          { targetUsers: userId },
          { targetRoles: req.user.role },
          { targetUsers: { $exists: false }, targetRoles: { $exists: false } }
        ],
        readBy: { $ne: userId }
      },
      { $addToSet: { readBy: userId } }
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user notifications
router.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // Get notifications for this user
    const notifications = await AdminNotification.find({
      $or: [
        { targetUsers: userId },
        { targetRoles: req.user.role },
        { targetUsers: { $exists: false }, targetRoles: { $exists: false } } // Global notifications
      ]
    })
    .sort({ createdAt: -1 })
    .limit(50);

    res.json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark notification as read
router.put('/:notificationId/read', authMiddleware, async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user._id;

    const notification = await AdminNotification.findById(notificationId);
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Add user to readBy array if not already there
    if (!notification.readBy.includes(userId)) {
      notification.readBy.push(userId);
      await notification.save();
    }

    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
