const express = require('express');
const router = express.Router();
const pointsController = require('../controllers/pointsControllerNew');
const authMiddleware = require('../middleware/auth');

// Daily login points
router.post('/daily-login', authMiddleware, pointsController.dailyLogin);

// Spin wheel
router.post('/spin-wheel', authMiddleware, pointsController.spinWheel);

// Award action points
router.post('/award-action', authMiddleware, pointsController.awardActionPoints);

// Get user points (enhanced)
router.get('/user/:userId', authMiddleware, pointsController.getUserPointsNew);
router.get('/user', authMiddleware, pointsController.getUserPointsNew);

// Get leaderboard
router.get('/leaderboard', pointsController.getLeaderboard);

// Legacy endpoints for backward compatibility
router.get('/:userId', pointsController.getUserPoints);
router.put('/:userId', pointsController.updateUserPoints);

module.exports = router;
