const express = require('express');
const router = express.Router();
const DoctorClaim = require('../models/DoctorClaim');
const InsuranceCompany = require('../models/InsuranceCompany');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const Clinic = require('../models/Clinic');
const auth = require('../middleware/auth');

// Get all claims for a doctor
router.get('/doctor/:doctorId', auth, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { status, insuranceCompanyId, page = 1, limit = 20 } = req.query;
    
    const query = { doctorId };
    if (status) query.status = status;
    if (insuranceCompanyId) query.insuranceCompanyId = insuranceCompanyId;
    
    const claims = await DoctorClaim.find(query)
      .populate('insuranceCompanyId', 'name nameAr')
      .populate('patientId', 'fullName mobileNumber')
      .populate('appointmentIds', 'appointmentDateTime appointmentFee status')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await DoctorClaim.countDocuments(query);
    
    res.json({
      claims,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching doctor claims:', error);
    res.status(500).json({ message: 'Error fetching claims', error: error.message });
  }
});

// Get all claims for a clinic (accountant view)
router.get('/clinic/:clinicId', auth, async (req, res) => {
  try {
    const { clinicId } = req.params;
    const { status, insuranceCompanyId, page = 1, limit = 20 } = req.query;
    
    const query = { clinicId };
    if (status) query.status = status;
    if (insuranceCompanyId) query.insuranceCompanyId = insuranceCompanyId;
    
    const claims = await DoctorClaim.find(query)
      .populate('insuranceCompanyId', 'name nameAr')
      .populate('patientId', 'fullName mobileNumber')
      .populate('doctorId', 'fullName')
      .populate('appointmentIds', 'appointmentDateTime appointmentFee status')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await DoctorClaim.countDocuments(query);
    
    res.json({
      claims,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching clinic claims:', error);
    res.status(500).json({ message: 'Error fetching claims', error: error.message });
  }
});

// Get a single claim
router.get('/:claimId', auth, async (req, res) => {
  try {
    const claim = await DoctorClaim.findById(req.params.claimId)
      .populate('insuranceCompanyId', 'name nameAr email phone coveragePercentage')
      .populate('patientId', 'fullName mobileNumber')
      .populate('doctorId', 'fullName specialty')
      .populate('appointmentIds');
    
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }
    
    res.json(claim);
  } catch (error) {
    console.error('Error fetching claim:', error);
    res.status(500).json({ message: 'Error fetching claim', error: error.message });
  }
});

// Create a new doctor/clinic claim
router.post('/', auth, async (req, res) => {
  try {
    const { 
      submittedBy,
      submittedByRole,
      doctorId,
      clinicId,
      insuranceCompanyId,
      patientId,
      patientName,
      appointmentIds,
      claimAmount,
      description,
      serviceType,
      serviceDate
    } = req.body;
    
    // Validate insurance company exists
    const insuranceCompany = await InsuranceCompany.findById(insuranceCompanyId);
    if (!insuranceCompany) {
      return res.status(404).json({ message: 'Insurance company not found' });
    }
    
    // Build display name
    let displayName = '';
    if (submittedByRole === 'Doctor') {
      const doctor = await User.findById(doctorId || submittedBy);
      displayName = doctor ? doctor.fullName : 'Unknown Doctor';
    } else if (submittedByRole === 'Accountant') {
      // For accountant, use the clinic name
      if (clinicId) {
        try {
          const clinic = await require('../models/Clinic').findById(clinicId);
          displayName = clinic ? clinic.name : 'Unknown Clinic';
        } catch (e) {
          // If Clinic model not available, try to get from user's clinicId
          displayName = 'Clinic';
        }
      }
      if (!displayName || displayName === 'Clinic') {
        // Fallback: use the accountant's clinic info
        const accountant = await User.findById(submittedBy);
        if (accountant && accountant.clinicId) {
          try {
            const clinic = await require('../models/Clinic').findById(accountant.clinicId);
            displayName = clinic ? clinic.name : 'Unknown Clinic';
          } catch (e) {
            displayName = 'Clinic';
          }
        }
      }
    }
    
    // Validate appointments if provided
    if (appointmentIds && appointmentIds.length > 0) {
      const appointments = await Appointment.find({ _id: { $in: appointmentIds } });
      if (appointments.length !== appointmentIds.length) {
        return res.status(404).json({ message: 'One or more appointments not found' });
      }
    }
    
    const claim = new DoctorClaim({
      submittedBy,
      submittedByRole,
      doctorId: doctorId || submittedBy,
      clinicId,
      displayName,
      insuranceCompanyId,
      patientId,
      patientName: patientName || '',
      appointmentIds: appointmentIds || [],
      claimAmount,
      description: description || '',
      serviceType: serviceType || 'consultation',
      serviceDate: serviceDate || new Date(),
      status: 'pending'
    });
    
    await claim.save();
    
    // Update insurance company pending amount
    await InsuranceCompany.findByIdAndUpdate(insuranceCompanyId, {
      $inc: { totalClaims: 1, pendingAmount: claimAmount }
    });
    
    // Populate and return
    const populatedClaim = await DoctorClaim.findById(claim._id)
      .populate('insuranceCompanyId', 'name nameAr')
      .populate('patientId', 'fullName mobileNumber')
      .populate('appointmentIds', 'appointmentDateTime appointmentFee status');
    
    res.status(201).json(populatedClaim);
  } catch (error) {
    console.error('Error creating doctor claim:', error);
    res.status(500).json({ message: 'Error creating claim', error: error.message });
  }
});

// Update claim status (for insurance company)
router.put('/:claimId/status', async (req, res) => {
  try {
    const { claimId } = req.params;
    const { status, approvedAmount, rejectionReason, reviewedBy } = req.body;
    
    const claim = await DoctorClaim.findById(claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }
    
    const updateData = { 
      status,
      reviewedAt: new Date(),
      reviewedBy
    };
    
    if (status === 'approved' || status === 'partially_approved') {
      updateData.approvedAmount = approvedAmount || claim.claimAmount;
      updateData.approvedAt = new Date();
      
      await InsuranceCompany.findByIdAndUpdate(claim.insuranceCompanyId, {
        $inc: { 
          pendingAmount: -claim.claimAmount,
          totalPaid: updateData.approvedAmount
        }
      });
    } else if (status === 'rejected') {
      updateData.rejectionReason = rejectionReason;
      updateData.approvedAmount = 0;
      
      await InsuranceCompany.findByIdAndUpdate(claim.insuranceCompanyId, {
        $inc: { pendingAmount: -claim.claimAmount }
      });
    } else if (status === 'paid') {
      updateData.paidAt = new Date();
    }
    
    const updatedClaim = await DoctorClaim.findByIdAndUpdate(claimId, updateData, { new: true })
      .populate('insuranceCompanyId', 'name nameAr')
      .populate('patientId', 'fullName mobileNumber')
      .populate('appointmentIds', 'appointmentDateTime appointmentFee status');
    
    res.json(updatedClaim);
  } catch (error) {
    console.error('Error updating claim status:', error);
    res.status(500).json({ message: 'Error updating claim', error: error.message });
  }
});

// Delete claim
router.delete('/:claimId', auth, async (req, res) => {
  try {
    const claim = await DoctorClaim.findById(req.params.claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }
    
    if (claim.status !== 'pending') {
      return res.status(400).json({ message: 'Can only delete pending claims' });
    }
    
    await InsuranceCompany.findByIdAndUpdate(claim.insuranceCompanyId, {
      $inc: { totalClaims: -1, pendingAmount: -claim.claimAmount }
    });
    
    await DoctorClaim.findByIdAndDelete(req.params.claimId);
    
    res.json({ message: 'Claim deleted successfully' });
  } catch (error) {
    console.error('Error deleting claim:', error);
    res.status(500).json({ message: 'Error deleting claim', error: error.message });
  }
});

// Get claim statistics for a doctor
router.get('/doctor/:doctorId/stats', auth, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const mongoose = require('mongoose');
    
    const stats = await DoctorClaim.aggregate([
      { $match: { doctorId: new mongoose.Types.ObjectId(doctorId) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$claimAmount' },
          approvedAmount: { $sum: '$approvedAmount' }
        }
      }
    ]);
    
    const summary = {
      totalClaims: 0,
      totalAmount: 0,
      approvedAmount: 0,
      pendingAmount: 0,
      rejectedCount: 0,
      byStatus: {}
    };
    
    stats.forEach(s => {
      summary.totalClaims += s.count;
      summary.totalAmount += s.totalAmount;
      summary.approvedAmount += s.approvedAmount;
      summary.byStatus[s._id] = {
        count: s.count,
        totalAmount: s.totalAmount,
        approvedAmount: s.approvedAmount
      };
      if (['pending', 'submitted', 'under_review'].includes(s._id)) {
        summary.pendingAmount += s.totalAmount;
      }
      if (s._id === 'rejected') {
        summary.rejectedCount = s.count;
      }
    });
    
    res.json(summary);
  } catch (error) {
    console.error('Error fetching doctor claim stats:', error);
    res.status(500).json({ message: 'Error fetching stats', error: error.message });
  }
});

// Get claim statistics for a clinic
router.get('/clinic/:clinicId/stats', auth, async (req, res) => {
  try {
    const { clinicId } = req.params;
    const mongoose = require('mongoose');
    
    const stats = await DoctorClaim.aggregate([
      { $match: { clinicId: new mongoose.Types.ObjectId(clinicId) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$claimAmount' },
          approvedAmount: { $sum: '$approvedAmount' }
        }
      }
    ]);
    
    const summary = {
      totalClaims: 0,
      totalAmount: 0,
      approvedAmount: 0,
      pendingAmount: 0,
      rejectedCount: 0,
      byStatus: {}
    };
    
    stats.forEach(s => {
      summary.totalClaims += s.count;
      summary.totalAmount += s.totalAmount;
      summary.approvedAmount += s.approvedAmount;
      summary.byStatus[s._id] = {
        count: s.count,
        totalAmount: s.totalAmount,
        approvedAmount: s.approvedAmount
      };
      if (['pending', 'submitted', 'under_review'].includes(s._id)) {
        summary.pendingAmount += s.totalAmount;
      }
      if (s._id === 'rejected') {
        summary.rejectedCount = s.count;
      }
    });
    
    res.json(summary);
  } catch (error) {
    console.error('Error fetching clinic claim stats:', error);
    res.status(500).json({ message: 'Error fetching stats', error: error.message });
  }
});

module.exports = router;
