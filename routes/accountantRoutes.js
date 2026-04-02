const express = require('express');
const router = express.Router();
const accountantController = require('../controllers/accountantController');
const authMiddleware = require('../middleware/auth');

// Middleware to verify accountant role
const verifyAccountantRole = (req, res, next) => {
  if (req.user.role !== 'Accountant') {
    return res.status(403).json({ message: 'Access denied. Accountant role required.' });
  }
  next();
};

// Apply auth middleware to all routes
router.use(authMiddleware);
router.use(verifyAccountantRole);

// Dashboard
router.get('/stats', accountantController.getDashboardStats);

// Patients
router.get('/patients', accountantController.getPatients);
router.post('/patients', accountantController.registerPatient);
router.get('/patients/search', accountantController.searchPatient);

// Doctors
router.get('/doctors', accountantController.getClinicDoctors);

// Appointments
router.get('/appointments', accountantController.getAppointments);
router.post('/appointments', accountantController.createAppointment);
router.put('/appointments/:appointmentId/pay', accountantController.markAsPaid);
router.put('/appointments/:appointmentId/accept', accountantController.acceptAppointment);
router.put('/appointments/:appointmentId/decline', accountantController.declineAppointment);
router.put('/appointments/:appointmentId/complete', accountantController.completeAppointment);

// Lab tests
router.post('/lab-tests', accountantController.requestLabTest);
router.put('/lab-tests/:requestId/pay', accountantController.markTestAsPaid);

// Lab request approval flow
router.get('/lab-requests', accountantController.getPendingLabRequests);
router.put('/lab-requests/:requestId/approve', accountantController.approveLabRequest);
router.put('/lab-requests/:requestId/reject', accountantController.rejectLabRequest);

// Reports
router.get('/monthly-report', accountantController.getMonthlyReport);
router.get('/patients/:patientId/receipt', accountantController.getPatientReceipt);

// Get single patient full data
router.get('/patients/:patientId/details', accountantController.getPatientById);

// Patient records
router.get('/patients/:patientId/records', accountantController.getPatientRecords);

// Update patient info
router.put('/patients/:patientId', accountantController.updatePatient);

// Insert payment
router.post('/payments', accountantController.insertPayment);

// Patient payments (view/edit/delete)
router.get('/patients/:patientId/payments', accountantController.getPatientPayments);
router.put('/payments/:transactionId', accountantController.editPayment);
router.delete('/payments/:transactionId', accountantController.deletePayment);

// Update medical record
router.put('/records/:recordId', accountantController.updateMedicalRecord);

// Patients with debt info
router.get('/patients-with-debt', accountantController.getPatientsWithDebt);

// Financial data (expenses, debts, income)
router.get('/financial', accountantController.getFinancialData);
router.post('/expenses', accountantController.addExpense);
router.put('/expenses/:expenseId', accountantController.updateExpense);
router.delete('/expenses/:expenseId', accountantController.deleteExpense);
router.post('/debts', accountantController.addDebt);
router.post('/debts/:debtId/pay', accountantController.payDebt);

// Suppliers
router.get('/suppliers', accountantController.getSuppliers);
router.post('/suppliers', accountantController.addSupplier);
router.put('/suppliers/:supplierId', accountantController.updateSupplier);
router.delete('/suppliers/:supplierId', accountantController.deleteSupplier);

// Staff list (for salary recipients)
router.get('/staff', accountantController.getStaffList);

// Invoices
router.post('/invoices', accountantController.createInvoice);

// Doctor clinic percentages
router.get('/doctors/percentages', accountantController.getDoctorsWithPercentages);
router.put('/doctors/:doctorId/percentage', accountantController.setDoctorClinicPercentage);

// Doctor accounts report
router.get('/doctor-accounts', accountantController.getDoctorAccountsReport);

// Pay doctor their share
router.post('/doctors/:doctorId/pay', accountantController.payDoctor);

module.exports = router;
