const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');

router.get('/notifications', async (req, res) => {
  try {
    const { userId } = req.query; // Get userId from query parameter
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    // Return all notifications for the user (both read and unread)
    const notifications = await Notification.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ notifications });
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ message: 'خطأ في الخادم أثناء جلب الإشعارات.' });
  }
});

router.get('/notifications/unread-count', async (req, res) => {
  try {
    const { userId } = req.query; // Get userId from query parameter
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const count = await Notification.countDocuments({ user: userId, isRead: false });
    res.json({ count });
  } catch (err) {
    console.error('Error fetching unread notification count:', err);
    res.status(500).json({ message: 'خطأ في الخادم أثناء جلب عدد الإشعارات غير المقروءة.' });
  }
});

// MUST be before /:id/read route
router.put('/notifications/mark-all-read', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    await Notification.updateMany(
      { user: userId, isRead: false },
      { isRead: true }
    );
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    console.error('Error marking all notifications as read:', err);
    res.status(500).json({ message: 'خطأ في الخادم أثناء تحديث الإشعارات.' });
  }
});

router.put('/notifications/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body; // Get userId from body
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: id, user: userId },
      { isRead: true },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ message: 'الإشعار غير موجود أو غير مخول.' });
    }
    res.json({ message: 'تم وضع علامة على الإشعار كمقروء', notification });
  } catch (err) {
    console.error('Error marking notification as read:', err);
    res.status(500).json({ message: 'خطأ في الخادم أثناء تحديث الإشعار.' });
  }
});

module.exports = router;