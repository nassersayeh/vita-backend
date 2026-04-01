// routes/profile.js
const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');

// Change from '/profile/:userId' to '/:userId'
router.get('/:userId', profileController.getProfile);
router.put('/:id', profileController.updateProfile); 
router.put('/activate/:id', profileController.updateActivationStatus);

module.exports = router;
