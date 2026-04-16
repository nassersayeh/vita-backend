const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const OversightAccount = require('../models/OversightAccount');
const DoctorClaim = require('../models/DoctorClaim');
const Claim = require('../models/Claim');
const InsuranceCompany = require('../models/InsuranceCompany');

// Login for oversight accounts
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const account = await OversightAccount.findOne({ username, status: 'active' });
    if (!account) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    const isMatch = await bcrypt.compare(password, account.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    // Update last login
    account.lastLoginAt = new Date();
    await account.save();
    
    // Generate token
    const token = jwt.sign(
      { accountId: account._id, type: account.type, role: 'oversight' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    res.json({
      message: 'Login successful',
      account: {
        id: account._id,
        name: account.name,
        nameAr: account.nameAr,
        type: account.type,
        role: 'oversight'
      },
      token
    });
  } catch (error) {
    console.error('Oversight login error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all claims (both doctor and pharmacy) for oversight view
router.get('/claims', async (req, res) => {
  try {
    const { status, type, page = 1, limit = 50 } = req.query;
    
    let doctorQuery = {};
    let pharmacyQuery = {};
    
    if (status) {
      doctorQuery.status = status;
      pharmacyQuery.status = status;
    }
    
    // Fetch doctor claims
    let doctorClaims = [];
    let pharmacyClaims = [];
    
    if (!type || type === 'all' || type === 'doctor') {
      doctorClaims = await DoctorClaim.find(doctorQuery)
        .populate('insuranceCompanyId', 'name nameAr')
        .populate('doctorId', 'fullName specialty')
        .populate('patientId', 'fullName')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .lean();
      
      doctorClaims = doctorClaims.map(c => ({
        ...c,
        claimType: 'doctor',
        source: c.displayName || 'Doctor'
      }));
    }
    
    if (!type || type === 'all' || type === 'pharmacy') {
      pharmacyClaims = await Claim.find(pharmacyQuery)
        .populate('insuranceCompanyId', 'name nameAr')
        .populate('pharmacyId', 'fullName')
        .populate('customerId', 'name phone')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .lean();
      
      pharmacyClaims = pharmacyClaims.map(c => ({
        ...c,
        claimType: 'pharmacy',
        source: c.pharmacyId?.fullName || 'Pharmacy'
      }));
    }
    
    // Merge and sort by date
    const allClaims = [...doctorClaims, ...pharmacyClaims]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    // Paginate
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const paginatedClaims = allClaims.slice(startIndex, startIndex + parseInt(limit));
    
    res.json({
      claims: paginatedClaims,
      total: allClaims.length,
      page: parseInt(page),
      totalPages: Math.ceil(allClaims.length / parseInt(limit))
    });
  } catch (error) {
    console.error('Error fetching oversight claims:', error);
    res.status(500).json({ message: 'Error fetching claims', error: error.message });
  }
});

// Get overall statistics for oversight
router.get('/stats', async (req, res) => {
  try {
    // Doctor claims stats
    const doctorStats = await DoctorClaim.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$claimAmount' },
          approvedAmount: { $sum: '$approvedAmount' }
        }
      }
    ]);
    
    // Pharmacy claims stats
    const pharmacyStats = await Claim.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$claimAmount' },
          approvedAmount: { $sum: '$approvedAmount' }
        }
      }
    ]);
    
    // Insurance companies info
    const insuranceCompanies = await InsuranceCompany.find({ status: 'active' })
      .select('name nameAr totalClaims totalPaid pendingAmount');
    
    // Build summary
    const summary = {
      doctorClaims: { total: 0, totalAmount: 0, approvedAmount: 0, byStatus: {} },
      pharmacyClaims: { total: 0, totalAmount: 0, approvedAmount: 0, byStatus: {} },
      overall: { totalClaims: 0, totalAmount: 0, approvedAmount: 0, pendingAmount: 0 },
      insuranceCompanies
    };
    
    doctorStats.forEach(s => {
      summary.doctorClaims.total += s.count;
      summary.doctorClaims.totalAmount += s.totalAmount;
      summary.doctorClaims.approvedAmount += s.approvedAmount;
      summary.doctorClaims.byStatus[s._id] = { count: s.count, totalAmount: s.totalAmount };
    });
    
    pharmacyStats.forEach(s => {
      summary.pharmacyClaims.total += s.count;
      summary.pharmacyClaims.totalAmount += s.totalAmount;
      summary.pharmacyClaims.approvedAmount += s.approvedAmount;
      summary.pharmacyClaims.byStatus[s._id] = { count: s.count, totalAmount: s.totalAmount };
    });
    
    summary.overall.totalClaims = summary.doctorClaims.total + summary.pharmacyClaims.total;
    summary.overall.totalAmount = summary.doctorClaims.totalAmount + summary.pharmacyClaims.totalAmount;
    summary.overall.approvedAmount = summary.doctorClaims.approvedAmount + summary.pharmacyClaims.approvedAmount;
    
    res.json(summary);
  } catch (error) {
    console.error('Error fetching oversight stats:', error);
    res.status(500).json({ message: 'Error fetching stats', error: error.message });
  }
});

module.exports = router;
