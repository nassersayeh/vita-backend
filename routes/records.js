const express = require('express');
const router = express.Router();
const Record = require('../models/Record');
const recordController = require('../controllers/recordController')
const mongoose = require('mongoose');

// GET /api/patients/:patientId/records
router.get('/:patientId/records', async (req, res) => {
  try {
    const { patientId } = req.params;
    const patientObjId = new mongoose.Types.ObjectId(patientId);
    const records = await Record.find({ patient: patientObjId });
    console.log('Patient ID:', patientId);
    console.log('Found records:', records);
    res.json(records);
  } catch (error) {
    console.error("Error fetching records:", error);
    res.status(500).json({ message: "Server error fetching records" });
  }
});


// POST /api/patients/:patientId/records
router.post('/:patientId/records', async (req, res) => {
  try {
    const { patientId } = req.params;
    const { visitDate, description, medication } = req.body;
    if (!visitDate || !description || !medication) {
      return res.status(400).json({ message: "All fields are required." });
    }
    const newRecord = new Record({
      patientId: patientId,
      visitDate,
      description,
      medication,
    });
    await newRecord.save();
    res.status(201).json(newRecord);
  } catch (error) {
    console.error("Error creating record:", error);
    res.status(500).json({ message: "Server error creating record" });
  }
});



// GET all records for a given patient.
router.get('/patient/:patientId', recordController.getRecordsByPatient);

// GET all records for a doctor.
router.get('/doctor/:doctorId', recordController.getDoctorRecords);

// GET a single record by its ID.
router.get('/:recordId', recordController.getRecordById);

// Create a record.
router.post('/', recordController.createRecord);

// Update a record.
router.put('/:recordId', recordController.updateRecord);

// Delete a record.
router.delete('/:recordId', recordController.deleteRecord);

// Search records.
router.get('/search', recordController.searchRecords);


module.exports = router;
