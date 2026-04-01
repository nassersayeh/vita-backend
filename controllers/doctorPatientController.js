const User = require('../models/User');
const DoctorPatientRequest = require('../models/DoctorPatientRequest');
const Notification = require('../models/Notification');
const bcrypt = require('bcrypt');
const { sendDoctorWhatsAppMessage } = require('../services/doctorWhatsappService');

// Helper function to auto-connect patient to doctor (skips if already connected)
const autoConnectPatientToDoctor = async (doctorId, patientId) => {
  // Check if already connected
  const existingRequest = await DoctorPatientRequest.findOne({ 
    doctor: doctorId, 
    patient: patientId,
    status: 'accepted'
  });
  
  if (existingRequest) {
    console.log(`Patient ${patientId} already connected to doctor ${doctorId}`);
    return { alreadyConnected: true };
  }

  // Check if there's a pending request and accept it
  const pendingRequest = await DoctorPatientRequest.findOne({ 
    doctor: doctorId, 
    patient: patientId,
    status: 'pending'
  });

  if (pendingRequest) {
    pendingRequest.status = 'accepted';
    pendingRequest.respondedAt = new Date();
    await pendingRequest.save();
  } else {
    // Create a new accepted request directly
    const newRequest = new DoctorPatientRequest({
      doctor: doctorId,
      patient: patientId,
      status: 'accepted',
      respondedAt: new Date()
    });
    await newRequest.save();
  }

  // Also add to doctor's patients array for backward compatibility
  const doctor = await User.findById(doctorId);
  if (doctor) {
    if (!doctor.patients) doctor.patients = [];
    if (!doctor.patients.includes(patientId)) {
      doctor.patients.push(patientId);
      await doctor.save();
    }
  }

  return { connected: true };
};

// Export the helper for use in other controllers
exports.autoConnectPatientToDoctor = autoConnectPatientToDoctor;

// Search patients by mobile number
exports.searchPatients = async (req, res) => {
  try {
    const { mobileNumber } = req.query;
    
    if (!mobileNumber || mobileNumber.trim().length < 5) {
      return res.status(400).json({ message: 'Please provide at least 5 digits of mobile number' });
    }

    // Search for patients with matching mobile number
    const patients = await User.find({
      mobileNumber: { $regex: mobileNumber, $options: 'i' },
      role: 'User'
    }).select('_id fullName mobileNumber city idNumber bloodType');

    res.json(patients);
  } catch (error) {
    console.error('Error searching patients:', error);
    res.status(500).json({ message: 'Server error searching patients' });
  }
};

// Create new patient account (called when doctor adds a patient who doesn't exist)
exports.createPatient = async (req, res) => {
  try {
    const { fullName, mobileNumber, country, city, idNumber, address, doctorId } = req.body;
    console.log('createPatient called with doctorId:', doctorId, 'mobileNumber:', mobileNumber);

    // Check if patient with this mobile number already exists
    const existingPatient = await User.findOne({ mobileNumber });
    if (existingPatient) {
      // If doctorId is provided, try to auto-connect existing patient to doctor
      if (doctorId) {
        try {
          await autoConnectPatientToDoctor(doctorId, existingPatient._id.toString());
        } catch (connectError) {
          console.log('Patient already connected or error:', connectError.message);
        }
      }
      return res.status(400).json({ 
        message: 'Patient with this mobile number already exists',
        existingPatient: {
          _id: existingPatient._id,
          fullName: existingPatient.fullName,
          mobileNumber: existingPatient.mobileNumber
        }
      });
    }

    // Check if ID number is unique
    const existingId = await User.findOne({ idNumber });
    if (existingId) {
      return res.status(400).json({ message: 'A user with this ID number already exists' });
    }

    // Generate a random password for the patient
    const randomPassword = Math.random().toString(36).slice(-12);
    const hashedPassword = await bcrypt.hash(randomPassword, 10);

    // Create new patient account
    const newPatient = new User({
      fullName,
      mobileNumber,
      country,
      city,
      idNumber,
      address,
      role: 'User',
      activationStatus: 'active',
      email: `${mobileNumber}@vita.local`, // Temporary email
      password: hashedPassword,
      // Generate short username: use last 8 digits of mobile + random 4 chars (max 14 chars)
      username: `p${mobileNumber.slice(-7)}${Math.random().toString(36).slice(-4)}`
    });

    await newPatient.save();

    // If doctorId is provided, auto-connect patient to doctor (no request needed)
    let whatsappSent = false;
    if (doctorId) {
      try {
        await autoConnectPatientToDoctor(doctorId, newPatient._id.toString());
        console.log(`Auto-connected new patient ${newPatient._id} to doctor ${doctorId}`);
        
        // Try to send WhatsApp message with credentials from doctor's WhatsApp
        try {
          const doctor = await User.findById(doctorId).select('fullName whatsappSession');
          if (doctor?.whatsappSession?.isConnected) {
            const message = `مرحباً ${fullName}! 👋\n\n` +
              `تم إنشاء حسابك في تطبيق Vita من قبل د. ${doctor.fullName}.\n\n` +
              `📱 بيانات تسجيل الدخول:\n` +
              `رقم الهاتف: ${mobileNumber}\n` +
              `كلمة المرور: ${randomPassword}\n\n` +
              `📲 حمّل التطبيق الآن:\n` +
              `Android: https://play.google.com/store/apps/details?id=ps.vita.health\n` +
              `iOS: https://apps.apple.com/eg/app/vita-%D9%81%D9%8A%D8%AA%D8%A7/id6754179480?l=ar`;
            
            await sendDoctorWhatsAppMessage(doctorId, mobileNumber, message);
            whatsappSent = true;
            console.log(`WhatsApp credentials sent to patient ${mobileNumber} from doctor ${doctorId}`);
          }
        } catch (whatsappError) {
          console.log('Could not send WhatsApp credentials (doctor may not be connected):', whatsappError.message);
          // Don't fail the patient creation
        }
      } catch (connectError) {
        console.error('Error auto-connecting patient to doctor:', connectError);
        // Don't fail the patient creation, just log the error
      }
    }

    // Return patient info and temporary password for doctor to share
    res.status(201).json({
      patient: {
        _id: newPatient._id,
        fullName: newPatient.fullName,
        mobileNumber: newPatient.mobileNumber,
        city: newPatient.city,
        idNumber: newPatient.idNumber
      },
      temporaryPassword: randomPassword,
      message: 'Patient account created. Share the temporary password with the patient.',
      autoConnected: !!doctorId,
      whatsappSent: whatsappSent
    });
  } catch (error) {
    console.error('Error creating patient:', error);
    res.status(500).json({ message: 'Server error creating patient account' });
  }
};

// Send connect request from doctor to patient
exports.sendConnectRequest = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { patientId } = req.body;

    // Validate doctor exists and is a doctor
    const doctor = await User.findOne({ _id: doctorId, role: 'Doctor' });
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    // Validate patient exists and is a patient (User role)
    const patient = await User.findOne({ _id: patientId, role: 'User' });
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Check if already connected or request exists
    const existingRequest = await DoctorPatientRequest.findOne({ doctor: doctorId, patient: patientId });
    if (existingRequest && existingRequest.status === 'accepted') {
      return res.status(400).json({ message: 'You are already connected with this patient' });
    }

    if (existingRequest && existingRequest.status === 'pending') {
      return res.status(400).json({ message: 'Connection request already sent, awaiting patient response' });
    }

    // Create or update request
    if (existingRequest) {
      // If previously rejected, allow resending
      existingRequest.status = 'pending';
      existingRequest.createdAt = new Date();
      await existingRequest.save();
    } else {
      const newRequest = new DoctorPatientRequest({
        doctor: doctorId,
        patient: patientId,
        status: 'pending'
      });
      await newRequest.save();
    }

    // Create notification for patient
    const notification = new Notification({
      user: patientId,
      type: 'doctor_connect_request',
      message: `Dr. ${doctor.fullName} would like to connect with you as your doctor.`,
      relatedId: doctorId
    });
    await notification.save();

    // Publish SSE event to patient and doctor
    try {
      const sse = require('../services/sseService');
      sse.publish(patientId, 'doctorConnectRequest', { doctorId, patientId });
      sse.publish(doctorId, 'doctorConnectRequestSent', { doctorId, patientId });
    } catch (err) {
      console.warn('Failed to publish SSE doctorConnectRequest', err);
    }

    res.json({ message: 'Connection request sent to patient' });
  } catch (error) {
    console.error('Error sending connect request:', error);
    res.status(500).json({ message: 'Server error sending connection request' });
  }
};

// Patient accepts doctor's connect request
exports.acceptConnectRequest = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { doctorId } = req.body;

    const request = await DoctorPatientRequest.findOne({ doctor: doctorId, patient: patientId });
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ message: 'Request is no longer pending' });
    }

    // Update request status
    request.status = 'accepted';
    request.respondedAt = new Date();
    await request.save();

    // Add patient to doctor's patients list
    const doctor = await User.findById(doctorId);
    if (!doctor.patients) doctor.patients = [];
    if (!doctor.patients.includes(patientId)) {
      doctor.patients.push(patientId);
      await doctor.save();
    }

    // Create notification for doctor
    const patient = await User.findById(patientId);
    const notification = new Notification({
      user: doctorId,
      type: 'doctor_connect_request',
      message: `${patient.fullName} accepted your connection request`,
      relatedId: patientId
    });
    await notification.save();

    // Publish SSE events
    try {
      const sse = require('../services/sseService');
      sse.publish(doctorId, 'doctorConnectRequestAccepted', { doctorId, patientId });
      sse.publish(patientId, 'doctorConnectRequestAccepted', { doctorId, patientId });
    } catch (err) {
      console.warn('Failed to publish SSE doctorConnectRequestAccepted', err);
    }

    res.json({ message: 'Connection request accepted' });
  } catch (error) {
    console.error('Error accepting request:', error);
    res.status(500).json({ message: 'Server error accepting request' });
  }
};

// Patient rejects doctor's connect request
exports.rejectConnectRequest = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { doctorId } = req.body;

    const request = await DoctorPatientRequest.findOne({ doctor: doctorId, patient: patientId });
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    request.status = 'rejected';
    request.respondedAt = new Date();
    await request.save();

    // Publish SSE events
    try {
      const sse = require('../services/sseService');
      sse.publish(doctorId, 'doctorConnectRequestRejected', { doctorId, patientId });
      sse.publish(patientId, 'doctorConnectRequestRejected', { doctorId, patientId });
    } catch (err) {
      console.warn('Failed to publish SSE doctorConnectRequestRejected', err);
    }

    res.json({ message: 'Connection request rejected' });
  } catch (error) {
    console.error('Error rejecting request:', error);
    res.status(500).json({ message: 'Server error rejecting request' });
  }
};

// Cancel a pending doctor->patient request (doctor action)
exports.cancelRequest = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { patientId } = req.body;
    const request = await DoctorPatientRequest.findOne({ doctor: doctorId, patient: patientId, status: 'pending' });
    if (!request) return res.status(404).json({ message: 'Request not found' });
    request.status = 'rejected';
    request.respondedAt = new Date();
    await request.save();

    // Publish SSE events
    try {
      const sse = require('../services/sseService');
      sse.publish(doctorId, 'doctorConnectRequestCancelled', { doctorId, patientId });
      sse.publish(patientId, 'doctorConnectRequestCancelled', { doctorId, patientId });
    } catch (err) {
      console.warn('Failed to publish SSE doctorConnectRequestCancelled', err);
    }

    res.json({ message: 'Request cancelled' });
  } catch (error) {
    console.error('Error cancelling request:', error);
    res.status(500).json({ message: 'Server error cancelling request' });
  }
};

// Get doctor's connected patients
exports.getDoctorPatients = async (req, res) => {
  try {
    const { doctorId } = req.params;

    // Get all accepted requests for this doctor
    const acceptedRequests = await DoctorPatientRequest.find({
      doctor: doctorId,
      status: 'accepted'
    }).populate('patient', '_id fullName mobileNumber city bloodType idNumber profileImage');

    const requestPatients = acceptedRequests.map(req => req.patient).filter(Boolean);

    // Also get patients from doctor.patients array (added by clinic/accountant)
    const User = require('../models/User');
    const doctor = await User.findById(doctorId).populate('patients', '_id fullName mobileNumber city bloodType idNumber profileImage');
    const directPatients = (doctor?.patients || []).filter(Boolean);

    // Merge both sources, deduplicate by _id
    const seen = new Set();
    const allPatients = [];
    for (const p of [...requestPatients, ...directPatients]) {
      const id = p._id?.toString();
      if (id && !seen.has(id)) {
        seen.add(id);
        allPatients.push(p);
      }
    }

    res.json(allPatients);
  } catch (error) {
    console.error('Error fetching doctor patients:', error);
    res.status(500).json({ message: 'Server error fetching patients' });
  }
};

// Get pending connection requests for a doctor (to show in UI)
exports.getPendingRequests = async (req, res) => {
  try {
    const { doctorId } = req.params;

    const pendingRequests = await DoctorPatientRequest.find({
      doctor: doctorId,
      status: 'pending'
    }).populate('patient', '_id fullName mobileNumber city');

    res.json(pendingRequests);
  } catch (error) {
    console.error('Error fetching pending requests:', error);
    res.status(500).json({ message: 'Server error fetching pending requests' });
  }
};

// Get pending connection requests for a patient (to show notifications)
exports.getPatientConnectRequests = async (req, res) => {
  try {
    const { patientId } = req.params;

    const pendingRequests = await DoctorPatientRequest.find({
      patient: patientId,
      status: 'pending'
    }).populate('doctor', '_id fullName specialty city licenseNumber');

    res.json(pendingRequests);
  } catch (error) {
    console.error('Error fetching connect requests:', error);
    res.status(500).json({ message: 'Server error fetching requests' });
  }
};

// Reset patient password (for patients created by doctor)
exports.resetPatientPassword = async (req, res) => {
  try {
    const { doctorId, patientId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Verify that the doctor has a connection with this patient
    const connection = await DoctorPatientRequest.findOne({
      doctor: doctorId,
      patient: patientId,
      status: 'accepted'
    });

    if (!connection) {
      return res.status(403).json({ message: 'You are not connected to this patient' });
    }

    // Find the patient
    const patient = await User.findById(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Hash the new password and update
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    patient.password = hashedPassword;
    await patient.save();

    // Try to send WhatsApp message with new password from doctor's WhatsApp
    let whatsappSent = false;
    try {
      if (patient.mobileNumber) {
        const message = `مرحباً بك في Vita! 👋\n\n` +
          `📱 بيانات تسجيل الدخول:\n` +
          `رقم الهاتف: ${patient.mobileNumber}\n` +
          `كلمة المرور: ${newPassword}\n\n` +
          `📲 حمّل التطبيق الآن:\n` +
          `Android: https://play.google.com/store/apps/details?id=com.vita.health\n` +
          `iOS: https://apps.apple.com/app/vita-health/id123456789\n\n` +
          `يُرجى تغيير كلمة المرور بعد تسجيل الدخول. 🔐`;
        
        await sendDoctorWhatsAppMessage(doctorId, patient.mobileNumber, message);
        whatsappSent = true;
        console.log(`WhatsApp password reset message sent to ${patient.mobileNumber}`);
      }
    } catch (whatsappError) {
      console.log('Failed to send WhatsApp password reset message:', whatsappError.message);
    }

    res.json({ 
      message: 'Password reset successfully',
      whatsappSent 
    });
  } catch (error) {
    console.error('Error resetting patient password:', error);
    res.status(500).json({ message: 'Server error resetting password' });
  }
};
