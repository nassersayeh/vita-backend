const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const path = require('path');
const fs = require('fs');
const {
  initializeDoctorWhatsApp,
  sendDoctorWhatsAppMessage,
  getDoctorWhatsAppStatus,
  disconnectDoctorWhatsApp,
  forceDisconnectDoctorWhatsApp
} = require('../services/doctorWhatsappService');

// Get doctor WhatsApp status
router.get('/doctor/:doctorId/whatsapp/status', authMiddleware, async (req, res) => {
  try {
    const { doctorId } = req.params;

    // Check if user is the doctor or admin
    if (req.user.role !== 'Admin' && req.user._id.toString() !== doctorId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const status = getDoctorWhatsAppStatus(doctorId);

    // Get additional info from database
    const doctor = await User.findById(doctorId).select('whatsappSession');
    if (doctor && doctor.whatsappSession) {
      status.phoneNumber = doctor.whatsappSession.phoneNumber;
      status.connectedAt = doctor.whatsappSession.connectedAt;
    }

    res.json({ whatsapp: status });
  } catch (error) {
    console.error('Error getting doctor WhatsApp status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Initialize/connect doctor WhatsApp
router.post('/doctor/:doctorId/whatsapp/connect', authMiddleware, async (req, res) => {
  try {
    const { doctorId } = req.params;

    // Check if user is the doctor or admin
    if (req.user.role !== 'Admin' && req.user._id.toString() !== doctorId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if doctor exists
    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== 'Doctor') {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    await initializeDoctorWhatsApp(doctorId);

    res.json({ message: 'WhatsApp connection initiated. Please scan the QR code.' });
  } catch (error) {
    console.error('Error initializing doctor WhatsApp:', error);
    res.status(500).json({ error: 'Failed to initialize WhatsApp connection' });
  }
});

// Send WhatsApp message from doctor to patient
router.post('/doctor/:doctorId/whatsapp/send-message', authMiddleware, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { patientId, phone, message } = req.body;

    // Check if user is the doctor or admin
    if (req.user.role !== 'Admin' && req.user._id.toString() !== doctorId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let phoneNumber;
    let patientName = 'Patient';

    // Get phone number either from patientId lookup or directly from phone parameter
    if (patientId) {
      // Get patient mobile number from database
      const patient = await User.findById(patientId).select('mobileNumber fullName');
      if (!patient) {
        return res.status(404).json({ error: 'Patient not found' });
      }

      if (!patient.mobileNumber) {
        return res.status(400).json({ error: 'Patient does not have a mobile number' });
      }
      
      phoneNumber = patient.mobileNumber;
      patientName = patient.fullName;
    } else if (phone) {
      // Use phone number directly
      phoneNumber = phone;
    } else {
      return res.status(400).json({ error: 'Patient ID or phone number is required' });
    }

    // Send message
    const result = await sendDoctorWhatsAppMessage(doctorId, phoneNumber, message);

    res.json({
      success: true,
      message: 'WhatsApp message sent successfully',
      patientName: patientName,
      phoneNumber: result.phone
    });
  } catch (error) {
    console.error('Error sending doctor WhatsApp message:', error);

    if (error.message.includes('not ready') || error.message.includes('not registered')) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Failed to send WhatsApp message' });
  }
});

// Disconnect doctor WhatsApp
router.post('/doctor/:doctorId/whatsapp/disconnect', authMiddleware, async (req, res) => {
  try {
    const { doctorId } = req.params;

    // Check if user is the doctor or admin
    if (req.user.role !== 'Admin' && req.user._id.toString() !== doctorId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await disconnectDoctorWhatsApp(doctorId);

    res.json({ message: 'WhatsApp disconnected successfully' });
  } catch (error) {
    console.error('Error disconnecting doctor WhatsApp:', error);
    res.status(500).json({ error: 'Failed to disconnect WhatsApp' });
  }
});

// Force disconnect and clear session (for stuck connections)
router.post('/doctor/:doctorId/whatsapp/force-disconnect', authMiddleware, async (req, res) => {
  try {
    const { doctorId } = req.params;

    // Check if user is the doctor or admin
    if (req.user.role !== 'Admin' && req.user._id.toString() !== doctorId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Force disconnect via service (handles cleanup even if client missing)
    await forceDisconnectDoctorWhatsApp(doctorId);

    res.json({ message: 'WhatsApp force disconnected and session cleared' });
  } catch (error) {
    console.error('Error force disconnecting doctor WhatsApp:', error);
    res.status(500).json({ error: 'Failed to force disconnect WhatsApp' });
  }
});

// Search patients for sending WhatsApp messages
router.get('/doctor/:doctorId/whatsapp/search-patients', authMiddleware, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { q } = req.query;

    // Check permissions
    if (req.user.role !== 'Admin' && req.user._id.toString() !== doctorId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Sanitize and normalize query
    const rawQ = (q || '').toString().trim();
    let queryStr = rawQ;
    // If query contains colon (e.g., '0567600951:1'), strip anything after ':'
    if (queryStr.includes(':')) {
      queryStr = queryStr.split(':')[0];
    }

    // Restrict to patients that belong to this doctor.
    // Support two storage models: direct doctor.patients array, or accepted DoctorPatientRequest entries.
    const doctor = await User.findById(doctorId).select('patients');
    const filter = { role: 'Patient' };

    let allowedPatientIds = null;
    if (doctor && Array.isArray(doctor.patients) && doctor.patients.length > 0) {
      allowedPatientIds = doctor.patients;
    } else {
      // fallback to accepted requests
      const DoctorPatientRequest = require('../models/DoctorPatientRequest');
      const accepted = await DoctorPatientRequest.find({ doctor: doctorId, status: 'accepted' }).select('patient');
      const ids = accepted.map(a => a.patient);
      if (ids.length > 0) allowedPatientIds = ids;
    }

    if (allowedPatientIds) {
      filter._id = { $in: allowedPatientIds };
    }

    if (queryStr) {
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(esc(queryStr), 'i');

      filter.$or = [
        { fullName: searchRegex },
        { email: searchRegex }
      ];

      // If query contains digits, attempt phone-oriented matches with variants
      const digits = queryStr.replace(/\D/g, '');
      if (digits) {
        // match any mobileNumber containing the digits
        filter.$or.push({ mobileNumber: { $regex: digits } });

        // try without leading zeros and with country codes
        const withoutLeadingZeros = digits.replace(/^0+/, '');
        if (withoutLeadingZeros) {
          filter.$or.push({ mobileNumber: { $regex: withoutLeadingZeros } });
          filter.$or.push({ mobileNumber: { $regex: `972${withoutLeadingZeros}` } });
          filter.$or.push({ mobileNumber: { $regex: `970${withoutLeadingZeros}` } });
        }
      }
    }

    const patients = await User.find(filter).select('_id fullName mobileNumber email').limit(200);
    console.log(`WhatsApp patient search for '${rawQ}' (normalized '${queryStr}') returned ${patients.length} results`);
    res.json({ patients });
  } catch (error) {
    console.error('Error searching patients for WhatsApp:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send WhatsApp messages to multiple patients
router.post('/doctor/:doctorId/whatsapp/send-messages', authMiddleware, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { patientIds, message } = req.body;

    if (req.user.role !== 'Admin' && req.user._id.toString() !== doctorId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!Array.isArray(patientIds) || patientIds.length === 0 || !message) {
      return res.status(400).json({ error: 'patientIds (array) and message are required' });
    }

    const results = [];

    for (const pid of patientIds) {
      try {
        const patient = await User.findById(pid).select('mobileNumber fullName');
        if (!patient || !patient.mobileNumber) {
          results.push({ patientId: pid, success: false, error: 'Patient not found or has no mobile' });
          continue;
        }

        await sendDoctorWhatsAppMessage(doctorId, patient.mobileNumber, message);
        results.push({ patientId: pid, success: true });
      } catch (err) {
        console.error(`Error sending message to ${pid}:`, err);
        results.push({ patientId: pid, success: false, error: err.message || 'send error' });
      }
    }

    res.json({ results });
  } catch (error) {
    console.error('Error sending WhatsApp messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;