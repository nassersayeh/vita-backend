const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const InsuranceCompany = require('../models/InsuranceCompany');
const DoctorClaim = require('../models/DoctorClaim');
const Claim = require('../models/Claim');

// Login for insurance company
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const company = await InsuranceCompany.findOne({ username, status: 'active' });
    if (!company) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    const isMatch = await bcrypt.compare(password, company.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { companyId: company._id, role: 'insurance' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    res.json({
      message: 'Login successful',
      account: {
        id: company._id,
        name: company.name,
        nameAr: company.nameAr,
        role: 'insurance'
      },
      token
    });
  } catch (error) {
    console.error('Insurance company login error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all claims for the logged-in insurance company (doctor + pharmacy claims)
router.get('/:id/all-claims', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, page = 1, limit = 50 } = req.query;
    
    let doctorQuery = { insuranceCompanyId: id };
    let pharmacyQuery = { insuranceCompanyId: id };
    
    if (status) {
      doctorQuery.status = status;
      pharmacyQuery.status = status;
    }
    
    // Doctor claims
    let doctorClaims = await DoctorClaim.find(doctorQuery)
      .populate('doctorId', 'fullName specialty')
      .populate('patientId', 'fullName')
      .sort({ createdAt: -1 })
      .lean();
    
    doctorClaims = doctorClaims.map(c => ({
      ...c,
      claimType: 'doctor',
      source: c.displayName || 'Doctor'
    }));
    
    // Pharmacy claims
    let pharmacyClaims = await Claim.find(pharmacyQuery)
      .populate('pharmacyId', 'fullName')
      .populate('customerId', 'name phone')
      .sort({ createdAt: -1 })
      .lean();
    
    pharmacyClaims = pharmacyClaims.map(c => ({
      ...c,
      claimType: 'pharmacy',
      source: c.pharmacyId?.fullName || 'Pharmacy'
    }));
    
    const allClaims = [...doctorClaims, ...pharmacyClaims]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const paginatedClaims = allClaims.slice(startIndex, startIndex + parseInt(limit));
    
    res.json({
      claims: paginatedClaims,
      total: allClaims.length,
      page: parseInt(page),
      totalPages: Math.ceil(allClaims.length / parseInt(limit))
    });
  } catch (error) {
    console.error('Error fetching insurance company claims:', error);
    res.status(500).json({ message: 'Error fetching claims', error: error.message });
  }
});

// Get all insurance companies
router.get('/', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    
    let query = {};
    
    if (status) {
      query.status = status;
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { nameAr: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [companies, total] = await Promise.all([
      InsuranceCompany.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      InsuranceCompany.countDocuments(query)
    ]);
    
    res.json({
      success: true,
      data: companies,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching insurance companies:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch insurance companies',
      error: error.message
    });
  }
});

// Get single insurance company
router.get('/:id', async (req, res) => {
  try {
    const company = await InsuranceCompany.findById(req.params.id);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Insurance company not found'
      });
    }
    
    res.json({
      success: true,
      data: company
    });
  } catch (error) {
    console.error('Error fetching insurance company:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch insurance company',
      error: error.message
    });
  }
});

// Create new insurance company
router.post('/', async (req, res) => {
  try {
    const {
      name,
      nameAr,
      email,
      phone,
      address,
      city,
      country,
      licenseNumber,
      website,
      contactPerson,
      contactPersonPhone,
      contactPersonEmail,
      username,
      password,
      coveragePercentage,
      maxCoverageAmount,
      status,
      notes,
      createdBy
    } = req.body;
    
    // Check if email already exists
    const existingCompany = await InsuranceCompany.findOne({ email });
    if (existingCompany) {
      return res.status(400).json({
        success: false,
        message: 'Insurance company with this email already exists'
      });
    }
    
    // Check if username already exists (if provided)
    if (username) {
      const existingUsername = await InsuranceCompany.findOne({ username });
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          message: 'Username already taken'
        });
      }
    }
    
    // Hash password if provided
    let hashedPassword = null;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }
    
    const company = new InsuranceCompany({
      name,
      nameAr,
      email,
      phone,
      address,
      city,
      country,
      licenseNumber,
      website,
      contactPerson,
      contactPersonPhone,
      contactPersonEmail,
      username,
      password: hashedPassword,
      coveragePercentage: coveragePercentage || 80,
      maxCoverageAmount: maxCoverageAmount || 0,
      status: status || 'active',
      notes,
      createdBy
    });
    
    await company.save();
    
    res.status(201).json({
      success: true,
      message: 'Insurance company created successfully',
      data: company
    });
  } catch (error) {
    console.error('Error creating insurance company:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create insurance company',
      error: error.message
    });
  }
});

// Update insurance company
router.put('/:id', async (req, res) => {
  try {
    const {
      name,
      nameAr,
      email,
      phone,
      address,
      city,
      country,
      licenseNumber,
      website,
      contactPerson,
      contactPersonPhone,
      contactPersonEmail,
      username,
      password,
      coveragePercentage,
      maxCoverageAmount,
      status,
      notes
    } = req.body;
    
    const company = await InsuranceCompany.findById(req.params.id);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Insurance company not found'
      });
    }
    
    // Check if email is being changed and already exists
    if (email && email !== company.email) {
      const existingEmail = await InsuranceCompany.findOne({ email });
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use by another company'
        });
      }
    }
    
    // Check if username is being changed and already exists
    if (username && username !== company.username) {
      const existingUsername = await InsuranceCompany.findOne({ username });
      if (existingUsername) {
        return res.status(400).json({
          success: false,
          message: 'Username already taken'
        });
      }
    }
    
    // Update fields
    if (name) company.name = name;
    if (nameAr !== undefined) company.nameAr = nameAr;
    if (email) company.email = email;
    if (phone) company.phone = phone;
    if (address !== undefined) company.address = address;
    if (city !== undefined) company.city = city;
    if (country !== undefined) company.country = country;
    if (licenseNumber !== undefined) company.licenseNumber = licenseNumber;
    if (website !== undefined) company.website = website;
    if (contactPerson !== undefined) company.contactPerson = contactPerson;
    if (contactPersonPhone !== undefined) company.contactPersonPhone = contactPersonPhone;
    if (contactPersonEmail !== undefined) company.contactPersonEmail = contactPersonEmail;
    if (username !== undefined) company.username = username;
    if (coveragePercentage !== undefined) company.coveragePercentage = coveragePercentage;
    if (maxCoverageAmount !== undefined) company.maxCoverageAmount = maxCoverageAmount;
    if (status) company.status = status;
    if (notes !== undefined) company.notes = notes;
    
    // Hash and update password if provided
    if (password) {
      company.password = await bcrypt.hash(password, 10);
    }
    
    company.updatedAt = new Date();
    await company.save();
    
    res.json({
      success: true,
      message: 'Insurance company updated successfully',
      data: company
    });
  } catch (error) {
    console.error('Error updating insurance company:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update insurance company',
      error: error.message
    });
  }
});

// Delete insurance company
router.delete('/:id', async (req, res) => {
  try {
    const company = await InsuranceCompany.findByIdAndDelete(req.params.id);
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Insurance company not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Insurance company deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting insurance company:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete insurance company',
      error: error.message
    });
  }
});

// Get insurance company statistics
router.get('/stats/summary', async (req, res) => {
  try {
    const [total, active, inactive, pending] = await Promise.all([
      InsuranceCompany.countDocuments(),
      InsuranceCompany.countDocuments({ status: 'active' }),
      InsuranceCompany.countDocuments({ status: 'inactive' }),
      InsuranceCompany.countDocuments({ status: 'pending' })
    ]);
    
    const financialStats = await InsuranceCompany.aggregate([
      {
        $group: {
          _id: null,
          totalClaims: { $sum: '$totalClaims' },
          totalPaid: { $sum: '$totalPaid' },
          pendingAmount: { $sum: '$pendingAmount' }
        }
      }
    ]);
    
    res.json({
      success: true,
      data: {
        total,
        active,
        inactive,
        pending,
        financial: financialStats[0] || { totalClaims: 0, totalPaid: 0, pendingAmount: 0 }
      }
    });
  } catch (error) {
    console.error('Error fetching insurance stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch insurance statistics',
      error: error.message
    });
  }
});

module.exports = router;
