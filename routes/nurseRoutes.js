const express = require('express');
const router = express.Router();
const nurseController = require('../controllers/nurseController');
const authMiddleware = require('../middleware/auth');

// Middleware to verify nurse role
const verifyNurseRole = (req, res, next) => {
  if (req.user.role !== 'Nurse') {
    return res.status(403).json({ message: 'Access denied. Nurse role required.' });
  }
  next();
};

// Apply auth middleware to all routes
router.use(authMiddleware);
router.use(verifyNurseRole);

// Dashboard
router.get('/stats', nurseController.getDashboardStats);

// Patients
router.get('/patients', nurseController.getPatients);

// Clinic doctors
router.get('/doctors', nurseController.getClinicDoctors);

// Notes CRUD
router.get('/notes', nurseController.getNotes);
router.get('/notes/:noteId', nurseController.getNoteById);
router.post('/notes', nurseController.createNote);
router.put('/notes/:noteId', nurseController.updateNote);
router.delete('/notes/:noteId', nurseController.deleteNote);

module.exports = router;
