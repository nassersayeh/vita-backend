const express = require('express');
const router = express.Router();
const clinicController = require('../controllers/clinicController');
const authMiddleware = require('../middleware/auth');

// Middleware to verify clinic role
const verifyClinicRole = (req, res, next) => {
  if (req.user.role !== 'Clinic') {
    return res.status(403).json({ message: 'Access denied. Clinic role required.' });
  }
  next();
};

// Apply auth middleware to all routes
router.use(authMiddleware);
router.use(verifyClinicRole);

// ==================== CLINIC INFO ====================
// Get clinic info
router.get('/info', clinicController.getClinicInfo);

// Update clinic info
router.put('/info', clinicController.updateClinicInfo);

// Get dashboard stats
router.get('/stats', clinicController.getDashboardStats);

// ==================== DOCTOR MANAGEMENT ====================
// Add a new doctor to the clinic
router.post('/doctors', clinicController.addDoctor);

// Update doctor info
router.put('/doctors/:doctorId', clinicController.updateDoctor);

// Remove doctor from clinic
router.delete('/doctors/:doctorId', clinicController.removeDoctor);

// Get doctor's schedule
router.get('/doctors/:doctorId/schedule', clinicController.getDoctorSchedule);

// Update doctor's schedule
router.put('/doctors/:doctorId/schedule', clinicController.updateDoctorSchedule);

// Reset doctor's password
router.post('/doctors/:doctorId/reset-password', clinicController.resetDoctorPassword);

// ==================== PATIENTS ====================
// Get all patients across all doctors
router.get('/patients', clinicController.getAllPatients);

// ==================== APPOINTMENTS ====================
// Get all appointments
router.get('/appointments', clinicController.getAllAppointments);

// Create appointment
router.post('/appointments', clinicController.createAppointment);

// Update appointment
router.put('/appointments/:appointmentId', clinicController.updateAppointment);

// Accept (confirm) appointment
router.put('/appointments/:appointmentId/accept', clinicController.acceptAppointment);

// Decline (cancel) appointment
router.put('/appointments/:appointmentId/decline', clinicController.declineAppointment);

// Complete appointment
router.put('/appointments/:appointmentId/complete', clinicController.completeAppointment);

// ==================== PRESCRIPTIONS ====================
// Get all prescriptions
router.get('/prescriptions', clinicController.getAllPrescriptions);

// ==================== FINANCIAL ====================
// Get financial summary
router.get('/financial', clinicController.getFinancialSummary);

// ==================== STAFF MANAGEMENT ====================
// Add a staff member (Nurse, Accountant, LabTech)
router.post('/staff', clinicController.addStaff);

// Update staff member
router.put('/staff/:staffId', clinicController.updateStaff);

// Remove staff member
router.delete('/staff/:staffId', clinicController.removeStaff);

// Reset staff password
router.post('/staff/:staffId/reset-password', clinicController.resetStaffPassword);

// ==================== MEDICAL RECORDS ====================
router.get('/medical-records', clinicController.getAllMedicalRecords);

// ==================== LAB REQUESTS ====================
router.get('/lab-requests', clinicController.getAllLabRequests);

// ==================== NURSE NOTES ====================
router.get('/nurse-notes', clinicController.getAllNurseNotes);

module.exports = router;
