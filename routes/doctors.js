// routes/doctors.js
const express = require('express');
const router = express.Router();
const doctorsController = require('../controllers/doctorsController');
const doctorPatientController = require('../controllers/doctorPatientController');
const User = require('../models/User');

// ============ STATIC ROUTES (MUST BE FIRST) ============
// Doctor-patient connection static routes
router.get('/search-patients', doctorPatientController.searchPatients);
router.post('/create-patient', doctorPatientController.createPatient);
router.get('/:doctorId/connected-patients', doctorPatientController.getDoctorPatients);

// Reset patient password (doctor can reset password for their patients)
router.post('/:doctorId/patients/:patientId/reset-password', doctorPatientController.resetPatientPassword);

// GET all users who have role === 'Doctor'
router.get('/', doctorsController.getAllDoctors);
router.get('/specialties', doctorsController.getSpecialties);
router.get('/cities', doctorsController.getCities);
router.get('/filter', doctorsController.filterDoctors);

// ============ DYNAMIC ROUTES (AFTER STATIC) ============
// New route to get a specific doctor by ID
router.get('/:doctorId', async (req, res) => {
  const doctorId = req.params.doctorId
  console.log("DoctorId " +doctorId)
    try {
      const doctor = await User.findOne({ _id: doctorId, role: 'Doctor' })
      if (!doctor) {
        return res.status(404).json({ message: 'Doctor not found' });
      }
      res.json({ doctor });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error fetching doctor details' });
    }
  });

// Update doctor workplaces
router.put('/:doctorId/workplaces', doctorsController.updateWorkplaces);

module.exports = router;
