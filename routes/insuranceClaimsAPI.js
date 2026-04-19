const express = require('express');
const router = express.Router();
const InsuranceClaim = require('../models/InsuranceClaim');
const User = require('../models/User');

// ==================== UNION / OVERSIGHT ROUTES (must be before /:pharmacyId) ====================

// Get all pharmacy claims (for union dashboard)
router.get('/union/all-claims', async (req, res) => {
  try {
    const { status, insuranceCompany, pharmacyName, page = 1, limit = 50 } = req.query;
    
    const filter = {};
    if (status) filter.status = status;
    if (insuranceCompany) filter.insuranceCompany = insuranceCompany;
    if (pharmacyName) filter.pharmacyName = { $regex: pharmacyName, $options: 'i' };
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [claims, total] = await Promise.all([
      InsuranceClaim.find(filter)
        .populate('pharmacyId', 'fullName mobileNumber city address idNumber')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      InsuranceClaim.countDocuments(filter)
    ]);
    
    // Aggregate stats (unfiltered)
    const allClaims = await InsuranceClaim.find({});
    const stats = {
      totalClaims: allClaims.length,
      totalValue: allClaims.reduce((sum, c) => sum + (c.claimsValue || 0), 0),
      pending: allClaims.filter(c => c.status === 'pending').length,
      underReview: allClaims.filter(c => c.status === 'under_review').length,
      rejected: allClaims.filter(c => c.status === 'rejected').length,
      paid: allClaims.filter(c => c.status === 'paid').length,
      paidValue: allClaims.filter(c => c.status === 'paid').reduce((sum, c) => sum + (c.paidAmount || c.claimsValue || 0), 0),
      uniquePharmacies: [...new Set(allClaims.map(c => c.pharmacyId?.toString()))].length,
      uniqueCompanies: [...new Set(allClaims.map(c => c.insuranceCompany))].length,
    };
    
    // Per-company breakdown
    const companyBreakdown = {};
    allClaims.forEach(c => {
      if (!companyBreakdown[c.insuranceCompany]) {
        companyBreakdown[c.insuranceCompany] = { total: 0, value: 0, pending: 0, paid: 0, rejected: 0 };
      }
      companyBreakdown[c.insuranceCompany].total++;
      companyBreakdown[c.insuranceCompany].value += c.claimsValue || 0;
      if (c.status === 'pending' || c.status === 'under_review') companyBreakdown[c.insuranceCompany].pending++;
      if (c.status === 'paid') companyBreakdown[c.insuranceCompany].paid++;
      if (c.status === 'rejected') companyBreakdown[c.insuranceCompany].rejected++;
    });
    
    res.json({ success: true, claims, total, stats, companyBreakdown, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    console.error('Error fetching union claims:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all pharmacies (for union dashboard)
router.get('/union/pharmacies', async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const filter = { role: 'Pharmacy' };
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { idNumber: { $regex: search, $options: 'i' } },
        { licenseNumber: { $regex: search, $options: 'i' } },
        { mobileNumber: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
      ];
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [pharmacies, total] = await Promise.all([
      User.find(filter)
        .select('fullName mobileNumber city address idNumber licenseNumber activationStatus createdAt insuranceCompanies')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(filter),
    ]);
    res.json({ success: true, pharmacies, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    console.error('Error fetching pharmacies:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ==================== INSURANCE COMPANY ROUTES (must be before /:pharmacyId) ====================

// Get all pharmacy claims for a specific insurance company (by name match)
router.get('/company/:companyName/claims', async (req, res) => {
  try {
    const { companyName } = req.params;
    const { status, page = 1, limit = 50 } = req.query;
    
    const filter = { insuranceCompany: decodeURIComponent(companyName) };
    if (status) filter.status = status;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [claims, total] = await Promise.all([
      InsuranceClaim.find(filter)
        .populate('pharmacyId', 'fullName mobileNumber city address')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      InsuranceClaim.countDocuments(filter)
    ]);
    
    // Stats
    const allClaims = await InsuranceClaim.find({ insuranceCompany: decodeURIComponent(companyName) });
    const stats = {
      total: allClaims.length,
      totalValue: allClaims.reduce((sum, c) => sum + (c.claimsValue || 0), 0),
      pending: allClaims.filter(c => c.status === 'pending').length,
      underReview: allClaims.filter(c => c.status === 'under_review').length,
      rejected: allClaims.filter(c => c.status === 'rejected').length,
      paid: allClaims.filter(c => c.status === 'paid').length,
      paidValue: allClaims.filter(c => c.status === 'paid').reduce((sum, c) => sum + (c.paidAmount || c.claimsValue || 0), 0),
    };
    
    res.json({ success: true, claims, total, stats, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    console.error('Error fetching company claims:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update claim status (for insurance company)
router.put('/claim/:claimId/status', async (req, res) => {
  try {
    const { claimId } = req.params;
    const { status, rejectionReason, paymentMethod, paymentReference, paidAmount, reviewedBy } = req.body;
    
    const claim = await InsuranceClaim.findById(claimId);
    if (!claim) return res.status(404).json({ success: false, message: 'Claim not found' });
    
    claim.status = status;
    claim.reviewedBy = reviewedBy || '';
    claim.reviewedAt = new Date();
    
    if (status === 'rejected' && rejectionReason) {
      claim.rejectionReason = rejectionReason;
    }
    
    if (status === 'paid') {
      claim.paymentMethod = paymentMethod || '';
      claim.paymentReference = paymentReference || '';
      claim.paidAmount = paidAmount || claim.claimsValue;
      claim.paidAt = new Date();
    }
    
    claim.statusHistory.push({
      status,
      changedBy: reviewedBy || 'Insurance Company',
      reason: status === 'rejected' ? rejectionReason : (status === 'paid' ? `تم الدفع عبر ${paymentMethod}` : ''),
      timestamp: new Date()
    });
    
    await claim.save();
    res.json({ success: true, data: claim });
  } catch (error) {
    console.error('Error updating claim status:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ==================== PHARMACY ROUTES ====================

// Get all claims for a pharmacy
router.get('/:pharmacyId', async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { status, insuranceCompany, startDate, endDate } = req.query;
    
    const filter = { pharmacyId };
    if (status) filter.status = status;
    if (insuranceCompany) filter.insuranceCompany = insuranceCompany;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    
    const claims = await InsuranceClaim.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: claims });
  } catch (error) {
    console.error('Error fetching insurance claims:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create a new insurance claim
router.post('/:pharmacyId', async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { insuranceCompany, startDate, endDate, claimsCount, claimsValue, notes } = req.body;
    
    if (!insuranceCompany || !startDate || !endDate || !claimsCount || !claimsValue) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    // Get pharmacy name
    const pharmacy = await User.findById(pharmacyId).select('fullName');
    
    const claim = new InsuranceClaim({
      pharmacyId,
      pharmacyName: pharmacy?.fullName || '',
      insuranceCompany,
      startDate,
      endDate,
      claimsCount,
      claimsValue,
      notes,
      status: 'pending',
      statusHistory: [{ status: 'pending', changedBy: pharmacy?.fullName || 'Pharmacy', reason: 'تم إنشاء المطالبة' }]
    });
    
    await claim.save();
    res.status(201).json({ success: true, data: claim });
  } catch (error) {
    console.error('Error creating insurance claim:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete a claim (only if still pending)
router.delete('/claim/:claimId', async (req, res) => {
  try {
    const { claimId } = req.params;
    const claim = await InsuranceClaim.findById(claimId);
    if (!claim) return res.status(404).json({ success: false, message: 'Claim not found' });
    if (claim.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending claims can be deleted' });
    }
    await InsuranceClaim.findByIdAndDelete(claimId);
    res.json({ success: true, message: 'Claim deleted successfully' });
  } catch (error) {
    console.error('Error deleting claim:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Check pharmacy activation status (for polling)
router.get('/:pharmacyId/activation-status', async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const user = await User.findById(pharmacyId).select('activationStatus isPaid');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, activationStatus: user.activationStatus, isPaid: user.isPaid });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
