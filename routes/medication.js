const express = require('express');
const router = express.Router();
const medicationController = require('../controllers/medicationController');

router.get('/:id', medicationController.getMedicationDetails);

module.exports = router;
