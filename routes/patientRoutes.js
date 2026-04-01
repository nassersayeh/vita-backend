const express = require('express');
const router = express.Router();
const patientController = require('../controllers/patientController');

// PUT /api/doctors/:doctorId/addPatient
router.put('/:doctorId/addPatient', patientController.addPatient);

module.exports = router;
