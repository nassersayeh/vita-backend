const express = require('express');
const router = express.Router();
const Prescription = require('../models/EPrescription');
const Drug = require('../models/Drug');
const MedicalTest = require('../models/MedicalTest');

// Create new prescription
router.post('/', async (req, res) => {
  try {
    const { 
      patientId, 
      doctorId, 
      products, 
      medications, // Support both products and medications
      medicalTests, 
      diagnosis, 
      notes, 
      expiryDate,
      validityType,
      validityPeriod
    } = req.body;

    // Support both 'products' (old) and 'medications' (new) format
    const prescriptionProducts = medications || products || [];

    if (!patientId || !doctorId || (!prescriptionProducts.length && !medicalTests?.length)) {
      return res.status(400).json({ 
        message: 'Patient, doctor, and at least one medication or medical test are required' 
      });
    }

    // Transform medications to products format if needed
    const transformedProducts = prescriptionProducts.map(med => ({
      drugId: med.drugId || med.productId,
      dose: med.dosage || med.dose,
      frequency: med.frequency || '',
      duration: med.duration || '',
      instructions: med.instructions || '',
      name: med.name
    }));

    const prescription = new Prescription({
      patientId,
      doctorId,
      products: transformedProducts,
      medicalTests: medicalTests || [],
      diagnosis,
      notes,
      validityType: validityType || 'time-limited',
      validityPeriod: validityPeriod || 7,
      expiryDate: expiryDate ? new Date(expiryDate) : new Date(Date.now() + (validityPeriod || 7) * 24 * 60 * 60 * 1000)
    });

    await prescription.save();

    const populatedPrescription = await Prescription.findById(prescription._id)
      .populate('patientId', 'fullName idNumber')
      .populate('doctorId', 'fullName specialty')
      .populate('products.drugId', 'name genericName')
      .populate('medicalTests.testId', 'name type category');

    // Attempt to notify the patient via the doctor's WhatsApp session
    try {
      const User = require('../models/User');
      const Notification = require('../models/Notification');
      const { sendDoctorWhatsAppMessage } = require('../services/doctorWhatsappService');

      const patient = await User.findById(patientId).select('fullName mobileNumber');
      const doctor = await User.findById(doctorId).select('fullName');

      // Create in-app notification as well (match Notification schema)
      if (patient) {
        await Notification.create({
          user: patientId,
          type: 'request', // use existing enum value for generic notifications
          message: 'قام الطبيب بإنشاء وصفة طبية لك. يمكنك فتح حسابك على فيتا لعرضها.',
          relatedId: prescription._id,
          isRead: false
        });
      }

      let whatsappResult = { sent: false };

      if (patient && patient.mobileNumber) {
        // Build a link to the prescription PDF (served by this API)
        const pdfLink = `${req.protocol}://${req.get('host')}/api/prescriptions-enhanced/${prescription._id}/pdf`;

        // Arabic message (requested wording)
        const message = `قام الطبيب بإنشاء وصفة طبية لك. يمكنك فتح حسابك على فيتا لعرضها: ${pdfLink}`;

        try {
          await sendDoctorWhatsAppMessage(doctorId, patient.mobileNumber, message);
          whatsappResult.sent = true;
        } catch (err) {
          whatsappResult.sent = false;
          whatsappResult.error = err.message || String(err);
          console.error('Failed to send prescription WhatsApp message:', err);
        }
      } else {
        whatsappResult.error = 'Patient has no mobile number';
      }

      return res.status(201).json({ prescription: populatedPrescription, whatsapp: whatsappResult });
    } catch (err) {
      console.error('Error during post-prescription notification:', err);
      // If notification flow fails, still return the prescription
      return res.status(201).json({ prescription: populatedPrescription, whatsapp: { sent: false, error: 'notification_failed' } });
    }
  } catch (error) {
    console.error('Create prescription error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update prescription
router.put('/:id', async (req, res) => {
  try {
    const { 
      patientId, 
      products, 
      medications,
      medicalTests, 
      diagnosis, 
      notes, 
      expiryDate,
      validityType,
      validityPeriod
    } = req.body;

    // Support both 'products' and 'medications' format
    const prescriptionProducts = medications || products || [];

    // Transform medications to products format if needed
    const transformedProducts = prescriptionProducts.map(med => ({
      drugId: med.drugId || med.productId,
      dose: med.dosage || med.dose,
      frequency: med.frequency || '',
      duration: med.duration || '',
      instructions: med.instructions || '',
      name: med.name
    }));

    const updateData = {
      patientId,
      products: transformedProducts,
      medicalTests: medicalTests || [],
      diagnosis,
      notes,
      validityType: validityType || 'time-limited',
      validityPeriod: validityPeriod || 7,
    };

    if (expiryDate) {
      updateData.expiryDate = new Date(expiryDate);
    } else if (validityType && validityPeriod) {
      updateData.expiryDate = new Date(Date.now() + (validityPeriod * 24 * 60 * 60 * 1000));
    }

    const prescription = await Prescription.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('patientId', 'fullName idNumber')
      .populate('doctorId', 'fullName specialty')
      .populate('products.drugId', 'name genericName')
      .populate('medicalTests.testId', 'name type category');

    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    res.json(prescription);
  } catch (error) {
    console.error('Update prescription error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete prescription
router.delete('/:id', async (req, res) => {
  try {
    const prescription = await Prescription.findByIdAndDelete(req.params.id);

    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    res.json({ message: 'Prescription deleted successfully' });
  } catch (error) {
    console.error('Delete prescription error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all prescriptions
router.get('/', async (req, res) => {
  try {
    const prescriptions = await Prescription.find({})
      .populate('patientId', 'fullName idNumber mobileNumber')
      .populate('doctorId', 'fullName specialty')
      .populate('dispensedBy', 'fullName')
      .populate('products.drugId', 'name genericName dosageForm strength')
      .populate('medicalTests.testId', 'name type category')
      .sort({ date: -1 });

    res.json(prescriptions);
  } catch (error) {
    console.error('Get all prescriptions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get prescriptions for a patient
router.get('/:patientId', async (req, res) => {
  try {
    const  {patientId}  = req.params;
    console.log("Getting prescriptions for patient ID:", patientId);
    const { status, page = 1, limit = 20, doctorId, date } = req.query;

    // Search for prescriptions where patientId OR patient field matches
    let filter = { patientId };
    
    if (status === 'valid') filter.isValid = true;
    if (status === 'invalid') filter.isValid = false;
    if (status === 'dispensed') filter.dispensedAt = { $exists: true };
    if (doctorId) filter.doctorId = doctorId;
    if (date) {
      // Filter by date (same day)
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      filter.date = { $gte: startDate, $lte: endDate };
    }

    const prescriptions = await Prescription.find(filter)
      .populate('doctorId', 'fullName specialty')
      .populate('products.drugId', 'name genericName')
      .populate('medicalTests.testId', 'name type')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    console.log(`Found ${prescriptions.length} prescriptions for patient ${patientId}`);

    const total = await Prescription.countDocuments(filter);

    res.json({
      prescriptions,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get patient prescriptions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get prescriptions for a doctor
router.get('/doctor/:doctorId', async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const prescriptions = await Prescription.find({ doctorId })
      .populate('patientId', 'fullName idNumber')
      .populate('products.drugId', 'name genericName')
      .populate('medicalTests.testId', 'name type')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Prescription.countDocuments({ doctorId });

    res.json({
      prescriptions,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get doctor prescriptions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Request prescription renewal
router.post('/:prescriptionId/renewal', async (req, res) => {
  try {
    const { prescriptionId } = req.params;
    const { notes } = req.body;

    const prescription = await Prescription.findById(prescriptionId);
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    // Check if there's already a pending renewal request
    const pendingRenewal = prescription.renewalRequests.find(
      req => req.status === 'pending'
    );
    if (pendingRenewal) {
      return res.status(400).json({ message: 'Renewal request already pending' });
    }

    prescription.renewalRequests.push({
      notes: notes || 'Renewal request'
    });

    await prescription.save();

    const populatedPrescription = await Prescription.findById(prescriptionId)
      .populate('patientId', 'fullName')
      .populate('doctorId', 'fullName');

    res.json({
      message: 'Renewal request submitted',
      prescription: populatedPrescription
    });
  } catch (error) {
    console.error('Request renewal error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Approve/reject renewal request
router.put('/:prescriptionId/renewal/:renewalIndex', async (req, res) => {
  try {
    const { prescriptionId, renewalIndex } = req.params;
    const { status, rejectionReason, notes } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const prescription = await Prescription.findById(prescriptionId);
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    const renewal = prescription.renewalRequests[renewalIndex];
    if (!renewal) {
      return res.status(404).json({ message: 'Renewal request not found' });
    }

    renewal.status = status;
    renewal.approvedDate = new Date();
    if (notes) renewal.notes = notes;
    if (rejectionReason) renewal.rejectionReason = rejectionReason;

    // If approved, extend prescription validity
    if (status === 'approved') {
      prescription.isValid = true;
      prescription.expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    }

    await prescription.save();

    res.json({
      message: `Renewal request ${status}`,
      prescription
    });
  } catch (error) {
    console.error('Process renewal error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Dispense prescription (pharmacy)
router.put('/:prescriptionId/dispense', async (req, res) => {
  try {
    const { prescriptionId } = req.params;
    const { pharmacyId, dispensingNotes } = req.body;

    const prescription = await Prescription.findById(prescriptionId);
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    if (!prescription.isValid) {
      return res.status(400).json({ message: 'Prescription is not valid' });
    }

    if (prescription.dispensedAt) {
      return res.status(400).json({ message: 'Prescription already dispensed' });
    }

    // Check if prescription is expired
    if (prescription.expiryDate && new Date() > prescription.expiryDate) {
      return res.status(400).json({ message: 'Prescription has expired' });
    }

    prescription.dispensedAt = new Date();
    prescription.dispensedBy = pharmacyId;
    prescription.dispensingNotes = dispensingNotes;
    prescription.isValid = false; // Mark as invalid after dispensing

    await prescription.save();

    const populatedPrescription = await Prescription.findById(prescriptionId)
      .populate('patientId', 'fullName')
      .populate('doctorId', 'fullName')
      .populate('dispensedBy', 'fullName');

    res.json({
      message: 'Prescription dispensed successfully',
      prescription: populatedPrescription
    });
  } catch (error) {
    console.error('Dispense prescription error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get prescription by ID
router.get('/:prescriptionId', async (req, res) => {
  try {
    const prescription = await Prescription.findById(req.params.prescriptionId)
      .populate('patientId', 'fullName idNumber mobileNumber')
      .populate('doctorId', 'fullName specialty')
      .populate('dispensedBy', 'fullName address')
      .populate('products.drugId', 'name genericName dosageForm strength')
      .populate('medicalTests.testId', 'name type category preparationInstructions');

    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    res.json(prescription);
  } catch (error) {
    console.error('Get prescription error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get pending renewal requests for doctor
router.get('/doctor/:doctorId/renewal-requests', async (req, res) => {
  try {
    const { doctorId } = req.params;

    const prescriptions = await Prescription.find({
      doctorId,
      'renewalRequests.status': 'pending'
    }).populate('patientId', 'fullName idNumber')
      .populate('products.drugId', 'name')
      .populate('medicalTests.testId', 'name');

    const pendingRenewals = [];
    prescriptions.forEach(prescription => {
      prescription.renewalRequests
        .filter(req => req.status === 'pending')
        .forEach(renewal => {
          pendingRenewals.push({
            _id: renewal._id,
            requestId: renewal._id,
            prescriptionId: prescription._id,
            prescriptionNumber: prescription.prescriptionNumber,
            patient: prescription.patientId,
            patientName: prescription.patientId?.fullName || 'Unknown Patient',
            prescriptionDetails: `RX-${prescription.prescriptionNumber}`,
            products: prescription.products,
            medicalTests: prescription.medicalTests,
            requestDate: renewal.requestDate,
            notes: renewal.notes,
            status: renewal.status
          });
        });
    });

    res.json(pendingRenewals);
  } catch (error) {
    console.error('Get pending renewals error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Check prescription validity for dispensing
router.get('/:id/validity', async (req, res) => {
  try {
    const prescription = await Prescription.findById(req.params.id)
      .populate('patientId', 'fullName mobileNumber')
      .populate('doctorId', 'fullName');

    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    const now = new Date();
    let isValid = true;
    let reason = '';

    // Check expiry date
    if (prescription.expiryDate && now > prescription.expiryDate) {
      isValid = false;
      reason = 'Prescription has expired';
    }
    // Check validity type
    else if (prescription.validityType === 'one-time' && prescription.dispensedCount > 0) {
      isValid = false;
      reason = 'Prescription has already been dispensed (one-time use)';
    }

    res.json({
      isValid,
      reason,
      prescription: {
        _id: prescription._id,
        prescriptionNumber: prescription.prescriptionNumber,
        validityType: prescription.validityType,
        validityPeriod: prescription.validityPeriod,
        expiryDate: prescription.expiryDate,
        dispensedCount: prescription.dispensedCount,
        patient: prescription.patientId,
        doctor: prescription.doctorId,
        products: prescription.products,
        medicalTests: prescription.medicalTests
      }
    });
  } catch (error) {
    console.error('Check prescription validity error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Dispense prescription
router.post('/:id/dispense', async (req, res) => {
  try {
    const { pharmacyId, dispensingNotes } = req.body;
    
    const prescription = await Prescription.findById(req.params.id);
    
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    // Check validity
    const now = new Date();
    let canDispense = true;
    let reason = '';

    if (prescription.expiryDate && now > prescription.expiryDate) {
      canDispense = false;
      reason = 'Prescription has expired';
    } else if (prescription.validityType === 'one-time' && prescription.dispensedCount > 0) {
      canDispense = false;
      reason = 'Prescription has already been dispensed (one-time use)';
    }

    if (!canDispense) {
      return res.status(400).json({ message: `Cannot dispense prescription: ${reason}` });
    }

    // Update prescription
    prescription.dispensedCount += 1;
    prescription.dispensedAt = now;
    prescription.dispensedBy = pharmacyId;
    prescription.dispensingNotes = dispensingNotes;
    
    // For one-time prescriptions, mark as invalid after dispensing
    if (prescription.validityType === 'one-time') {
      prescription.isValid = false;
    }

    await prescription.save();

    res.json({ 
      message: 'Prescription dispensed successfully',
      prescription 
    });
  } catch (error) {
    console.error('Dispense prescription error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
