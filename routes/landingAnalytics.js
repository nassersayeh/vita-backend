const express = require('express');
const router = express.Router();
const landingAnalyticsController = require('../controllers/landingAnalyticsController');

router.post('/visit', landingAnalyticsController.trackVisit);
router.post('/signup', landingAnalyticsController.trackSignup);

module.exports = router;
