const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const InsuranceClaim = require('../models/InsuranceClaim');
const User = require('../models/User');

// Configure multer with memory storage (Vercel compatible)
const claimUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.xlsx', '.xls', '.csv', '.jpg', '.jpeg', '.png', '.gif', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('File type not allowed'));
  }
});

// ==================== UNION / OVERSIGHT ROUTES (must be before /:pharmacyId) ====================

// Get all pharmacy claims (for union dashboard)
router.get('/union/all-claims', async (req, res) => {
  try {
    const { status, insuranceCompany, pharmacyName, page = 1, limit = 50 } = req.query;
    
    const filter = { status: { $ne: 'draft' } };
    if (status) filter.status = status;
    if (insuranceCompany) filter.insuranceCompany = insuranceCompany;
    if (pharmacyName) filter.pharmacyName = { $regex: pharmacyName, $options: 'i' };
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [claims, total] = await Promise.all([
      InsuranceClaim.find(filter)
        .select('-attachmentData')
        .populate('pharmacyId', 'fullName mobileNumber city address idNumber')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      InsuranceClaim.countDocuments(filter)
    ]);
    
    // Aggregate stats (exclude drafts)
    const allClaims = await InsuranceClaim.find({ status: { $ne: 'draft' } }).select('-attachmentData');
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

// Get insurance companies for a specific pharmacy (for claims)
router.get('/union/pharmacy/:pharmacyId/insurance-companies', async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    
    // Get all claims for this pharmacy (excluding drafts)
    const allClaims = await InsuranceClaim.find({ 
      pharmacyId, 
      status: { $ne: 'draft' } 
    }).select('-attachmentData');
    
    // Group by insurance company
    const companyMap = {};
    allClaims.forEach(claim => {
      if (!companyMap[claim.insuranceCompany]) {
        companyMap[claim.insuranceCompany] = {
          company: claim.insuranceCompany,
          total: 0,
          pending: 0,
          underReview: 0,
          rejected: 0,
          paid: 0
        };
      }
      companyMap[claim.insuranceCompany].total++;
      if (claim.status === 'pending' || claim.status === 'under_review') {
        if (claim.status === 'pending') {
          companyMap[claim.insuranceCompany].pending++;
        } else {
          companyMap[claim.insuranceCompany].underReview++;
        }
      } else if (claim.status === 'rejected') {
        companyMap[claim.insuranceCompany].rejected++;
      } else if (claim.status === 'paid') {
        companyMap[claim.insuranceCompany].paid++;
      }
    });
    
    const companies = Object.values(companyMap);
    res.json({ success: true, companies });
  } catch (error) {
    console.error('Error fetching pharmacy insurance companies:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get claims for a specific pharmacy and insurance company
router.get('/union/pharmacy/:pharmacyId/company/:companyName', async (req, res) => {
  try {
    const { pharmacyId, companyName } = req.params;
    
    const claims = await InsuranceClaim.find({
      pharmacyId,
      insuranceCompany: decodeURIComponent(companyName),
      status: { $ne: 'draft' }
    })
      .select('-attachmentData -claimsValue -paidAmount')
      .populate('pharmacyId', 'fullName')
      .sort({ createdAt: -1 });
    
    res.json({ success: true, claims });
  } catch (error) {
    console.error('Error fetching pharmacy company claims:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ==================== INSURANCE COMPANY ROUTES (must be before /:pharmacyId) ====================

// Get all pharmacy claims for a specific insurance company (by name match)
router.get('/company/:companyName/claims', async (req, res) => {
  try {
    const { companyName } = req.params;
    const { status, page = 1, limit = 50 } = req.query;
    
    const filter = { insuranceCompany: decodeURIComponent(companyName), status: { $ne: 'draft' } };
    if (status) filter.status = status;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [claims, total] = await Promise.all([
      InsuranceClaim.find(filter)
        .select('-attachmentData')
        .populate('pharmacyId', 'fullName mobileNumber city address')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      InsuranceClaim.countDocuments(filter)
    ]);
    
    // Stats
    const allClaims = await InsuranceClaim.find({ insuranceCompany: decodeURIComponent(companyName), status: { $ne: 'draft' } }).select('-attachmentData');
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

// Download claim attachment
router.get('/claim/:claimId/attachment', async (req, res) => {
  try {
    const claim = await InsuranceClaim.findById(req.params.claimId).select('attachmentData attachmentName attachmentMime');
    if (!claim || !claim.attachmentData) {
      return res.status(404).json({ success: false, message: 'No attachment found' });
    }
    const buffer = Buffer.from(claim.attachmentData, 'base64');
    res.set({
      'Content-Type': claim.attachmentMime || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(claim.attachmentName || 'attachment')}"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  } catch (error) {
    console.error('Error downloading attachment:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

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
    
    const claims = await InsuranceClaim.find(filter).select('-attachmentData').sort({ createdAt: -1 });
    res.json({ success: true, data: claims });
  } catch (error) {
    console.error('Error fetching insurance claims:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create a new insurance claim
router.post('/:pharmacyId', claimUpload.single('attachment'), async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { insuranceCompany, claimMonth, claimYear, startDate, endDate, claimsCount, claimsValue, notes } = req.body;

    if (!insuranceCompany || !claimsCount || !claimsValue) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    // Build startDate/endDate from month/year if provided
    let resolvedStart = startDate;
    let resolvedEnd = endDate;
    if (claimMonth && claimYear) {
      const month = parseInt(claimMonth);
      const year = parseInt(claimYear);
      resolvedStart = new Date(year, month - 1, 1);
      resolvedEnd = new Date(year, month, 0); // last day of month
    }

    // Get pharmacy name
    const pharmacy = await User.findById(pharmacyId).select('fullName');
    
    const claimData = {
      pharmacyId,
      pharmacyName: pharmacy?.fullName || '',
      insuranceCompany,
      claimMonth: claimMonth || '',
      claimYear: claimYear || '',
      startDate: resolvedStart,
      endDate: resolvedEnd,
      claimsCount,
      claimsValue,
      notes,
      status: 'draft',
      servicePaymentStatus: 'unpaid',
      statusHistory: [{ status: 'draft', changedBy: pharmacy?.fullName || 'Pharmacy', reason: 'تم إنشاء مسودة المطالبة' }]
    };

    if (req.file) {
      claimData.attachmentData = req.file.buffer.toString('base64');
      claimData.attachmentName = req.file.originalname;
      claimData.attachmentMime = req.file.mimetype;
    }

    const claim = new InsuranceClaim(claimData);
    
    await claim.save();
    res.status(201).json({ success: true, data: claim });
  } catch (error) {
    console.error('Error creating insurance claim:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Pay for draft claims and send them (simulate payment)
router.post('/:pharmacyId/pay-drafts', async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { cardNumber, cardHolder, expiryDate, cvv, claimIds, skipPayment } = req.body;

    // === التحقق من بيانات البطاقة معطّل مؤقتاً ===
    // if (!skipPayment && (!cardNumber || !cardHolder || !expiryDate || !cvv)) {
    //   return res.status(400).json({ success: false, message: 'All card details are required' });
    // }

    // Find draft claims for this pharmacy
    let filter = { pharmacyId, status: 'draft' };
    if (claimIds && claimIds.length > 0) {
      filter._id = { $in: claimIds };
    }
    const drafts = await InsuranceClaim.find(filter).select('-attachmentData');
    
    if (drafts.length === 0) {
      return res.status(400).json({ success: false, message: 'No draft claims found' });
    }

    const aprilCutoff = new Date('2026-04-01');
    let totalFee = 0;
    drafts.forEach(d => { totalFee += (d.startDate < aprilCutoff) ? 5 : 10; });

    const paymentRef = `DIRECT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const maskedCard = skipPayment ? 'N/A' : `****${(cardNumber || '').replace(/\s/g, '').slice(-4)}`;

    // Update all drafts to pending
    await InsuranceClaim.updateMany(
      { _id: { $in: drafts.map(d => d._id) } },
      {
        $set: {
          status: 'pending',
          servicePaymentStatus: skipPayment ? 'unpaid' : 'paid',
          servicePaymentRef: paymentRef,
          servicePaymentDate: new Date(),
        },
        $push: {
          statusHistory: {
            status: 'pending',
            changedBy: 'Pharmacy',
            reason: skipPayment ? 'تم الإرسال مباشرة' : `تم الدفع ${totalFee} شيكل - ${maskedCard}`,
            timestamp: new Date()
          }
        }
      }
    );

    res.json({
      success: true,
      message: 'Claims sent successfully',
      data: { claimsCount: drafts.length, totalFee, paymentRef, maskedCard }
    });
  } catch (error) {
    console.error('Error processing claims:', error);
    res.status(500).json({ success: false, message: 'Failed to send claims' });
  }
});

// Delete a claim (only if still pending or draft)
router.delete('/claim/:claimId', async (req, res) => {
  try {
    const { claimId } = req.params;
    const claim = await InsuranceClaim.findById(claimId);
    if (!claim) return res.status(404).json({ success: false, message: 'Claim not found' });
    if (claim.status !== 'pending' && claim.status !== 'draft') {
      return res.status(400).json({ success: false, message: 'Only pending/draft claims can be deleted' });
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
