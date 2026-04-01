const express = require('express');
const router = express.Router();

const pointsController = require('../controllers/pointsController');
// Get user points
router.get('/:userId', pointsController.getUserPoints);

// Update user points (increase them based on spinner result)
router.put('/:userId', pointsController.updateUserPoints);

module.exports = router;
