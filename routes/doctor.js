const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const User = require('../models/User');
const Clinic = require('../models/Clinic');
const doctorController = require('../controllers/doctorsController');
const doctorPatientController = require('../controllers/doctorPatientController');
// Helper function to generate a unique username based on email.
async function generateUniqueUsername(email) {
  const base = email.split('@')[0].substring(0, 14);
  let username = base;
  let count = 0;
  while (await User.findOne({ username })) {
    count++;
    const suffix = count.toString();
    const allowedBaseLength = Math.max(0, 14 - suffix.length);
    username = base.substring(0, allowedBaseLength) + suffix;
  }
  return username;
}

// ============ DYNAMIC ROUTES ============
// GET /api/doctors/:doctorId/patients - fetch doctor's patients
router.get('/:doctorId/patients', async (req, res) => {
  try {
    const { doctorId } = req.params;
    const doctor = await User.findOne({ _id: doctorId, role: 'Doctor' }).populate('patients');
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }
    
    // Compute total outstanding debt per patient from Financial.debts (clinic owner's record)
    const Financial = require('../models/Financial');
    const Clinic = require('../models/Clinic');
    const Appointment = require('../models/Appointment');
    const patientIds = doctor.patients.map(p => p._id);

    // Find the clinic this doctor belongs to
    let clinic = null;
    if (doctor.clinicId) {
      clinic = await Clinic.findById(doctor.clinicId);
    }
    if (!clinic) {
      clinic = await Clinic.findOne({
        $or: [
          { ownerId: doctorId },
          { 'doctors.doctorId': doctorId, 'doctors.status': 'active' }
        ]
      });
    }
    const financialOwnerId = clinic ? clinic.ownerId : doctorId;

    // Get debts from clinic owner's Financial record
    const debtMap = {};
    const ownerFinancial = await Financial.findOne({ doctorId: financialOwnerId });
    if (ownerFinancial && ownerFinancial.debts) {
      for (const debt of ownerFinancial.debts) {
        if (debt.status === 'pending' && debt.patientId) {
          const pid = debt.patientId.toString();
          debtMap[pid] = (debtMap[pid] || 0) + (debt.amount || 0);
        }
      }
    }
    
    // Also check doctor's own Financial for old debts (backwards compatibility)
    if (financialOwnerId.toString() !== doctorId.toString()) {
      const doctorFinancial = await Financial.findOne({ doctorId: doctorId });
      if (doctorFinancial && doctorFinancial.debts) {
        for (const debt of doctorFinancial.debts) {
          if (debt.status === 'pending' && debt.patientId) {
            const pid = debt.patientId.toString();
            debtMap[pid] = (debtMap[pid] || 0) + (debt.amount || 0);
          }
        }
      }
    }

    // Also add appointment debts (old system)
    const appointmentDebts = await Appointment.aggregate([
      { $match: { doctorId: doctor._id, patient: { $in: patientIds }, debt: { $gt: 0 } } },
      { $group: { _id: '$patient', totalAppointmentDebt: { $sum: '$debt' } } }
    ]);
    appointmentDebts.forEach(d => {
      const pid = d._id.toString();
      debtMap[pid] = (debtMap[pid] || 0) + d.totalAppointmentDebt;
    });

    // Attach totalDebt to each patient object (lean clone)
    const patientsWithDebt = doctor.patients.map(p => {
      const patient = p.toObject ? p.toObject() : p;
      patient.totalDebt = debtMap[patient._id.toString()] || 0;
      return patient;
    });

    res.json(patientsWithDebt);
  } catch (error) {
    console.error('Error fetching doctor patients:', error);
    res.status(500).json({ message: 'Server error fetching patients' });
  }
});

// PUT /api/doctors/:doctorId/addPatient - add a patient to the doctor's list
router.put('/:doctorId/addPatient', async (req, res) => {
  try {
    const doctorId = req.params.doctorId;
    const { userId, fullName, age, gender, password, mobileNumber, email, address } = req.body;

    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== 'Doctor') {
      return res.status(404).json({ message: 'الطبيب غير موجود.' });
    }
    let patient;
    if (email) {
      // Adding existing user as patient
      patient = await User.findById(email);
      if (!patient) {
        return res.status(404).json({ message: 'المستخدم الموجود غير موجود.' });
      }
    } else if (fullName && age && gender && password && mobileNumber && email && address) {
      // Creating new user and adding as patient
      patient = new User({
        fullName,
        age: Number(age),
        gender,
        password,
        mobileNumber,
        email,
        address,
        role: 'User',
        activationStatus: 'active',
      });
      await patient.save();
    } else {
      return res.status(400).json({ message: 'جميع الحقول مطلوبة لإضافة مستخدم جديد.' });
    }

    // Associate patient with doctor
    if (!doctor.patients) doctor.patients = [];
    if (!doctor.patients.includes(patient._id)) {
      doctor.patients.push(patient._id);
      await doctor.save();
    }

    res.status(200).json({ message: 'تمت إضافة المريض بنجاح.', patient });
  } catch (error) {
    console.error('Error adding patient:', error);
    res.status(500).json({ message: 'خطأ في الخادم أثناء إضافة المريض.' });
  }
});

router.post('/:doctorId/requestPatient', doctorController.requestPatient);

// Doctor-patient connection routes - DYNAMIC ROUTES
router.post('/:doctorId/send-connect-request', doctorPatientController.sendConnectRequest);
router.post('/:doctorId/cancel-request', doctorPatientController.cancelRequest);
router.get('/:doctorId/connected-patients', doctorPatientController.getDoctorPatients);
router.get('/:doctorId/pending-requests', doctorPatientController.getPendingRequests);
router.get('/:patientId/connect-requests', doctorPatientController.getPatientConnectRequests);

// Patient accept/reject requests
router.post('/:patientId/accept-request', doctorPatientController.acceptConnectRequest);
router.post('/:patientId/reject-request', doctorPatientController.rejectConnectRequest);

// GET /api/doctors/:doctorId/clinic-lab-staff - get clinic's LabTech staff for clinic-managed doctor
router.get('/:doctorId/clinic-lab-staff', async (req, res) => {
  try {
    const { doctorId } = req.params;
    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== 'Doctor') {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    if (!doctor.managedByClinic || !doctor.clinicId) {
      return res.status(400).json({ message: 'Doctor is not managed by a clinic' });
    }

    const clinic = await Clinic.findById(doctor.clinicId);
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }

    // Get active LabTech staff from the clinic
    const labTechStaff = clinic.staff.filter(s => s.role === 'LabTech' && s.status === 'active');
    const labTechUserIds = labTechStaff.map(s => s.userId);

    // Populate user details for each LabTech
    const labTechUsers = await User.find(
      { _id: { $in: labTechUserIds } },
      'fullName mobileNumber email city address profileImage'
    );

    res.json(labTechUsers);
  } catch (error) {
    console.error('Error fetching clinic lab staff:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/doctors/:doctorId/patients/:patientId/details - get full patient data including medical history
router.get('/:doctorId/patients/:patientId/details', async (req, res) => {
  try {
    const { doctorId, patientId } = req.params;
    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== 'Doctor') {
      return res.status(404).json({ message: 'Doctor not found' });
    }
    const patient = await User.findById(patientId).select('-password -resetCode -twoFactorCode -phoneVerificationCode');
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    res.json({ success: true, patient });
  } catch (error) {
    console.error('Error fetching patient details:', error);
    res.status(500).json({ message: 'Server error fetching patient details' });
  }
});

// GET /api/doctors/:doctorId/trial-status - get trial status for doctor
router.get('/:doctorId/trial-status', async (req, res) => {
  try {
    const { doctorId } = req.params;
    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role === 'User') {
      return res.status(404).json({ message: 'Doctor not found' });
    }
    let trialEndDate = doctor.trialEndDate;
    if (!trialEndDate) {
      const endDate = new Date(doctor.createdAt);
      endDate.setMonth(endDate.getMonth() + 3);
      trialEndDate = endDate;
      doctor.trialEndDate = trialEndDate;
      await doctor.save();
    }
    const now = new Date();
    const isTrialActive = !doctor.isPaid && now < trialEndDate;
    const timeLeft = isTrialActive ? trialEndDate - now : 0;
    res.json({
      isTrialActive,
      trialEndDate,
      timeLeft, // in milliseconds
      isPaid: doctor.isPaid
    });
  } catch (error) {
    console.error('Error fetching trial status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
