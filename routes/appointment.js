const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointmentController');

// Existing endpoints...
// router.post('/create', appointmentController.createAppointment);
// ...

// Rate provider after completed appointment
router.post('/rate-provider', appointmentController.rateProvider);

module.exports = router;
