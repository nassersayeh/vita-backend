const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointmentController');
const Appointment = require('../models/Appointment');

// POST /api/appointments - Create a new appointment
router.post('/', appointmentController.createAppointment);

// GET /api/appointments/available-dates - Get available dates for doctor's workplaces
router.get('/available-dates', appointmentController.getAvailableDatesAndTimes);

// GET /api/appointments/available-times - Get available time slots for a specific date and workplace
router.get('/available-times', appointmentController.getAvailableTimeSlots);

// GET /api/appointments/doctor/:doctorId/revenue/monthly - Get doctor's monthly revenue statistics (MUST BE BEFORE generic :doctorId route)
router.get('/doctor/:doctorId/revenue/monthly', appointmentController.getDoctorRevenueByMonth);

// GET /api/appointments/doctor/:doctorId/date/:date - Get appointments for a doctor on a specific date
router.get('/doctor/:doctorId/date/:date', async (req, res) => {
  try {
    const { doctorId, date } = req.params;
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const appointments = await Appointment.find({
      doctorId,
      appointmentDateTime: { $gte: startOfDay, $lte: endOfDay },
      status: { $ne: 'cancelled' } // Exclude cancelled appointments
    }).select('appointmentDateTime');

    res.json({ appointments });
  } catch (error) {
    console.error('Error fetching appointments by date:', error);
    res.status(500).json({ message: 'Server error fetching appointments' });
  }
});

// GET /api/appointments/doctor/:doctorId - Get all appointments for a doctor (MUST BE AFTER specific routes)
router.get('/doctor/:doctorId', appointmentController.getDoctorAppointments);

// GET /api/appointments/patient/:patientId/latest - Get latest appointment for a patient
router.get('/patient/:patientId/latest', appointmentController.getLatestAppointmentForPatient);

// GET /api/appointments/user/:userId/appointments - Get all appointments for a patient
router.get('/user/:userId/appointments', async (req, res) => {
  try {
    const { userId } = req.params;
    const appointments = await Appointment.find({ patient: userId })
      .populate('doctorId', 'fullName specialization city')
      .populate('patient', 'fullName');
    // Ensure rating and isRated are always present in the response
    const appointmentsWithRating = appointments.map(app => ({
      ...app.toObject(),
      rating: app.rating ?? 0,
      isRated: !!app.isRated
    }));
    res.json(appointmentsWithRating);
  } catch (error) {
    console.error('Error fetching user appointments:', error);
    res.status(500).json({ message: 'Server error fetching appointments' });
  }
});

// GET /api/appointments/:appointmentId - Fetch appointment details
router.get('/:appointmentId', async (req, res) => {
  try {
    const { appointmentId } = req.params;

    // Guard against invalid ObjectId to avoid cast errors
    if (!appointmentId || !appointmentId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid appointment id' });
    }

    const appointment = await Appointment.findById(appointmentId)
      .populate('doctorId', 'fullName specialization city')
      .populate('patient', 'fullName');
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }
    res.json({ appointment });
  } catch (error) {
    console.error('Error fetching appointment details:', error);
    res.status(500).json({ message: 'Server error fetching appointment details' });
  }
});

// POST /api/appointments/:appointmentId/rate - Rate a doctor for an appointment
router.post('/:appointmentId/rate', appointmentController.rateProvider);

// PUT /api/appointments/:appointmentId/status - Update appointment status
router.put('/:appointmentId/status', appointmentController.updateAppointmentStatus);

// PUT /api/appointments/:appointmentId/reschedule - Reschedule appointment
router.put('/:appointmentId/reschedule', appointmentController.updateAppointmentDateTime);

// PUT /api/appointments/:appointmentId/mark-paid - Mark appointment as paid
router.put('/:appointmentId/mark-paid', appointmentController.markAppointmentAsPaid);

// PUT /api/appointments/:appointmentId/set-doctor-fee - Doctor sets fee and creates debt
router.put('/:appointmentId/set-doctor-fee', appointmentController.setDoctorFeeAndDebt);

// POST /api/appointments/auto-mark-paid - Auto-mark appointments as paid (cron job endpoint)
router.post('/auto-mark-paid', appointmentController.autoMarkAppointmentsAsPaid);

// PUT /api/appointments/:appointmentId - Update appointment
router.put('/:appointmentId', appointmentController.updateAppointment);

// DELETE /api/appointments/:appointmentId - Delete appointment
router.delete('/:appointmentId', appointmentController.deleteAppointment);

// DEBUG ENDPOINT: Mark recent confirmed appointments as paid for testing
router.post('/debug/mark-test-paid/:doctorId', async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { count = 5 } = req.body;
    
    // Find recent confirmed appointments that aren't paid
    const appointments = await Appointment.find({
      doctorId,
      status: 'confirmed',
      isPaid: false,
      appointmentDateTime: { $lte: new Date() } // Past appointments
    })
      .sort({ appointmentDateTime: -1 })
      .limit(count)
      .populate('doctorId', 'consultationFee');

    let markedCount = 0;
    for (const appointment of appointments) {
      const amount = appointment.doctorId?.consultationFee || 100;
      appointment.isPaid = true;
      appointment.paymentAmount = amount;
      appointment.appointmentFee = amount;
      appointment.debt = 0;
      appointment.debtStatus = 'none';
      appointment.paidAt = new Date();
      appointment.autoMarkedAsPaid = false;
      await appointment.save();
      markedCount++;
    }

    res.json({ 
      message: `Marked ${markedCount} test appointments as paid`,
      markedCount,
      appointmentsMarked: appointments.length
    });
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    res.status(500).json({ message: 'Error marking test appointments' });
  }
});

module.exports = router;
