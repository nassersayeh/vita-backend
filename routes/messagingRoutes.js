const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const messagingController = require('../controllers/messagingController');

// All routes require authentication
router.use(authMiddleware);

// Only clinic members can use messaging (Clinic owner, Doctor, Nurse, Accountant, LabTech)
const verifyClinicMember = (req, res, next) => {
  const allowedRoles = ['Clinic', 'Doctor', 'Nurse', 'Accountant', 'LabTech'];
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ message: 'هذه الميزة متاحة فقط لأعضاء العيادة' });
  }
  next();
};

router.use(verifyClinicMember);

// Get all clinic members you can message
router.get('/members', messagingController.getClinicMembers);

// Get total unread messages count
router.get('/unread-count', messagingController.getUnreadCount);

// Get conversation with a specific member
router.get('/conversation/:memberId', messagingController.getConversation);

// Send a message
router.post('/send', messagingController.sendMessage);

// Mark messages from a member as read
router.put('/read/:memberId', messagingController.markAsRead);

// Delete a message
router.delete('/:messageId', messagingController.deleteMessage);

module.exports = router;
