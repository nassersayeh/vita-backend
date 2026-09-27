// routes/profile.js
const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const auth = require('../middleware/auth');
const { ownerOrAdmin, requireAdmin } = require('../middleware/accountAuthorization');
router.use(auth);

// Change from '/profile/:userId' to '/:userId'
router.get('/:userId', ownerOrAdmin('userId'), profileController.getProfile);
router.put('/:id', ownerOrAdmin('id'), profileController.updateProfile);
router.put('/activate/:id', requireAdmin, profileController.updateActivationStatus);

module.exports = router;
