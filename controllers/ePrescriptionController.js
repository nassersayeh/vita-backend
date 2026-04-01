const EPrescription = require('../models/EPrescription');

exports.getEPrescriptionsByUser = async (req, res) => {
  try {
    const { userId } = req.query;
    const prescriptions = await EPrescription.find({ userId });
    res.json(prescriptions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Request prescription renewal
exports.requestRenewal = async (req, res) => {
  try {
    const { prescriptionId } = req.params;
    const { patientId, notes } = req.body;

    const prescription = await EPrescription.findById(prescriptionId);
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    if (prescription.patientId.toString() !== patientId) {
      return res.status(403).json({ message: 'Unauthorized to request renewal for this prescription' });
    }

    // Check if there's already a pending renewal request
    const hasPendingRequest = prescription.renewalRequests.some(request => request.status === 'pending');
    if (hasPendingRequest) {
      return res.status(400).json({ message: 'A renewal request is already pending for this prescription' });
    }

    prescription.renewalRequests.push({
      requestDate: new Date(),
      status: 'pending',
      notes: notes || ''
    });

    await prescription.save();
    res.json({ message: 'Renewal request submitted successfully' });
  } catch (error) {
    console.error('Error requesting prescription renewal:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get renewal requests for doctor
exports.getRenewalRequests = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const prescriptions = await EPrescription.find({
      doctorId,
      'renewalRequests.status': 'pending'
    }).populate('patientId', 'fullName email phone');

    const renewalRequests = [];
    prescriptions.forEach(prescription => {
      prescription.renewalRequests.forEach(request => {
        if (request.status === 'pending') {
          renewalRequests.push({
            prescriptionId: prescription._id,
            prescriptionNumber: prescription.prescriptionNumber,
            patient: prescription.patientId,
            diagnosis: prescription.diagnosis,
            products: prescription.products,
            requestDate: request.requestDate,
            notes: request.notes,
            requestId: request._id
          });
        }
      });
    });

    res.json(renewalRequests);
  } catch (error) {
    console.error('Error fetching renewal requests:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Approve or reject renewal request
exports.processRenewalRequest = async (req, res) => {
  try {
    const { prescriptionId, requestId } = req.params;
    const { action, rejectionReason } = req.body;

    const prescription = await EPrescription.findById(prescriptionId);
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    const renewalRequest = prescription.renewalRequests.id(requestId);
    if (!renewalRequest) {
      return res.status(404).json({ message: 'Renewal request not found' });
    }

    if (renewalRequest.status !== 'pending') {
      return res.status(400).json({ message: 'Request has already been processed' });
    }

    if (action === 'approve') {
      renewalRequest.status = 'approved';
      renewalRequest.approvedDate = new Date();

      // Reset prescription validity
      prescription.isValid = true;
      prescription.dispensedAt = null;
      prescription.dispensedBy = null;
      prescription.dispensingNotes = '';
      prescription.dispensedCount = 0;
      prescription.expiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    } else if (action === 'reject') {
      renewalRequest.status = 'rejected';
      renewalRequest.rejectionReason = rejectionReason || 'Request rejected by doctor';
    }

    await prescription.save();
    res.json({ message: `Renewal request ${action}d successfully` });
  } catch (error) {
    console.error('Error processing renewal request:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
