const express = require('express');
const router = express.Router();
const EPrescription = require('../models/EPrescription');
const User = require('../models/User');

// Create a prescription renewal request
router.post('/request', async (req, res) => {
  try {
    const {
      prescriptionId,
      patientId,
      renewalType,
      reason,
      selectedMedications,
      additionalNotes,
      contactPreference
    } = req.body;
    
    // Validate required fields
    if (!prescriptionId || !patientId || !reason || !selectedMedications || selectedMedications.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }
    
    // Find the original prescription
    const originalPrescription = await EPrescription.findById(prescriptionId);
    if (!originalPrescription) {
      return res.status(404).json({
        success: false,
        message: 'Original prescription not found'
      });
    }
    
    // Check if prescription belongs to the patient
    if (originalPrescription.patientId.toString() !== patientId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to prescription'
      });
    }
    
    // Create renewal request object
    const renewalRequest = {
      requestId: new Date().getTime().toString(),
      requestDate: new Date(),
      renewalType: renewalType || 'standard',
      reason,
      selectedMedications,
      additionalNotes: additionalNotes || '',
      contactPreference: contactPreference || 'app',
      status: 'pending',
      patientId,
      requestedBy: patientId
    };
    
    // Add renewal request to the prescription
    if (!originalPrescription.renewalRequests) {
      originalPrescription.renewalRequests = [];
    }
    originalPrescription.renewalRequests.push(renewalRequest);
    
    await originalPrescription.save();
    
    res.status(201).json({
      success: true,
      message: 'Renewal request submitted successfully',
      data: {
        requestId: renewalRequest.requestId,
        prescriptionId,
        status: 'pending',
        estimatedProcessingTime: renewalType === 'urgent' ? '24-48 hours' : '3-5 business days'
      }
    });
  } catch (error) {
    console.error('Error creating renewal request:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while processing renewal request'
    });
  }
});

// Get renewal requests for a patient
router.get('/patient/:patientId', async (req, res) => {
  try {
    const { patientId } = req.params;
    const { status } = req.query;
    
    // Find all prescriptions for the patient that have renewal requests
    const prescriptions = await EPrescription.find({
      patientId,
      renewalRequests: { $exists: true, $ne: [] }
    }).populate('doctorId', 'fullName specialization');
    
    let allRenewalRequests = [];
    
    prescriptions.forEach(prescription => {
      prescription.renewalRequests.forEach(renewal => {
        // Filter by status if provided
        if (!status || renewal.status === status) {
          allRenewalRequests.push({
            ...renewal.toObject(),
            prescriptionId: prescription._id,
            doctorName: prescription.doctorId?.fullName || 'Unknown Doctor',
            doctorSpecialization: prescription.doctorId?.specialization || '',
            originalPrescriptionDate: prescription.date
          });
        }
      });
    });
    
    // Sort by request date (newest first)
    allRenewalRequests.sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
    
    res.status(200).json({
      success: true,
      data: allRenewalRequests
    });
  } catch (error) {
    console.error('Error fetching renewal requests:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching renewal requests'
    });
  }
});

// Get renewal requests for a doctor
router.get('/doctor/:doctorId', async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { status } = req.query;
    
    // Find all prescriptions by the doctor that have renewal requests
    const prescriptions = await EPrescription.find({
      doctorId,
      renewalRequests: { $exists: true, $ne: [] }
    }).populate('patientId', 'fullName mobileNumber');
    
    let allRenewalRequests = [];
    
    prescriptions.forEach(prescription => {
      prescription.renewalRequests.forEach(renewal => {
        // Filter by status if provided
        if (!status || renewal.status === status) {
          allRenewalRequests.push({
            ...renewal.toObject(),
            prescriptionId: prescription._id,
            patientName: prescription.patientId?.fullName || 'Unknown Patient',
            patientPhone: prescription.patientId?.mobileNumber || '',
            originalPrescriptionDate: prescription.date,
            originalMedications: prescription.products
          });
        }
      });
    });
    
    // Sort by request date (newest first)
    allRenewalRequests.sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));
    
    res.status(200).json({
      success: true,
      data: allRenewalRequests
    });
  } catch (error) {
    console.error('Error fetching doctor renewal requests:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching renewal requests'
    });
  }
});

// Update renewal request status (for doctors)
router.put('/update-status', async (req, res) => {
  try {
    const {
      prescriptionId,
      requestId,
      status,
      doctorNotes,
      doctorId
    } = req.body;
    
    // Validate required fields
    if (!prescriptionId || !requestId || !status) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }
    
    // Find the prescription
    const prescription = await EPrescription.findById(prescriptionId);
    if (!prescription) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found'
      });
    }
    
    // Check if doctor owns this prescription
    if (doctorId && prescription.doctorId.toString() !== doctorId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to prescription'
      });
    }
    
    // Find and update the renewal request
    const renewalRequest = prescription.renewalRequests.find(
      req => req.requestId === requestId
    );
    
    if (!renewalRequest) {
      return res.status(404).json({
        success: false,
        message: 'Renewal request not found'
      });
    }
    
    // Update the renewal request
    renewalRequest.status = status;
    renewalRequest.doctorNotes = doctorNotes || '';
    renewalRequest.reviewedAt = new Date();
    renewalRequest.reviewedBy = doctorId;
    
    // If approved, create a new prescription
    if (status === 'approved') {
      const newPrescription = new EPrescription({
        patientId: prescription.patientId,
        doctorId: prescription.doctorId,
        date: new Date(),
        expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
        products: renewalRequest.selectedMedications.map(medId => {
          return prescription.products.find(p => p._id.toString() === medId);
        }).filter(Boolean),
        medicalTests: [],
        notes: `Renewal of prescription ${prescriptionId}. ${doctorNotes || ''}`,
        isValid: true,
        renewalOf: prescriptionId,
        renewalRequestId: requestId
      });
      
      await newPrescription.save();
      renewalRequest.newPrescriptionId = newPrescription._id;
    }
    
    await prescription.save();
    
    res.status(200).json({
      success: true,
      message: `Renewal request ${status} successfully`,
      data: {
        requestId,
        status,
        newPrescriptionId: renewalRequest.newPrescriptionId || null
      }
    });
  } catch (error) {
    console.error('Error updating renewal request:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating renewal request'
    });
  }
});

// Get renewal request details
router.get('/details/:prescriptionId/:requestId', async (req, res) => {
  try {
    const { prescriptionId, requestId } = req.params;
    
    const prescription = await EPrescription.findById(prescriptionId)
      .populate('patientId', 'fullName mobileNumber')
      .populate('doctorId', 'fullName specialization');
    
    if (!prescription) {
      return res.status(404).json({
        success: false,
        message: 'Prescription not found'
      });
    }
    
    const renewalRequest = prescription.renewalRequests.find(
      req => req.requestId === requestId
    );
    
    if (!renewalRequest) {
      return res.status(404).json({
        success: false,
        message: 'Renewal request not found'
      });
    }
    
    const requestDetails = {
      ...renewalRequest.toObject(),
      prescriptionId: prescription._id,
      patientName: prescription.patientId?.fullName || 'Unknown Patient',
      patientPhone: prescription.patientId?.mobileNumber || '',
      doctorName: prescription.doctorId?.fullName || 'Unknown Doctor',
      doctorSpecialization: prescription.doctorId?.specialization || '',
      originalPrescriptionDate: prescription.date,
      originalMedications: prescription.products,
      selectedMedicationDetails: renewalRequest.selectedMedications.map(medId => {
        return prescription.products.find(p => p._id.toString() === medId);
      }).filter(Boolean)
    };
    
    res.status(200).json({
      success: true,
      data: requestDetails
    });
  } catch (error) {
    console.error('Error fetching renewal request details:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching renewal request details'
    });
  }
});

module.exports = router;
