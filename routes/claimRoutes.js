const express = require('express');
const router = express.Router();
const Claim = require('../models/Claim');
const Order = require('../models/Order');
const PharmacyCustomer = require('../models/PharmacyCustomer');
const InsuranceCompany = require('../models/InsuranceCompany');

// Get all claims for a pharmacy
router.get('/pharmacy/:pharmacyId', async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { status, insuranceCompanyId, page = 1, limit = 20 } = req.query;
    
    const query = { pharmacyId };
    if (status) query.status = status;
    if (insuranceCompanyId) query.insuranceCompanyId = insuranceCompanyId;
    
    const claims = await Claim.find(query)
      .populate('customerId', 'name phone')
      .populate('insuranceCompanyId', 'name nameAr')
      .populate('orderId', 'total status paymentMethod createdAt')
      .populate('orderIds', 'total status paymentMethod createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await Claim.countDocuments(query);
    
    res.json({
      claims,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching claims:', error);
    res.status(500).json({ message: 'Error fetching claims', error: error.message });
  }
});

// Get all claims for an insurance company
router.get('/insurance/:insuranceCompanyId', async (req, res) => {
  try {
    const { insuranceCompanyId } = req.params;
    const { status, page = 1, limit = 20 } = req.query;
    
    const query = { insuranceCompanyId };
    if (status) query.status = status;
    
    const claims = await Claim.find(query)
      .populate('customerId', 'name phone')
      .populate('pharmacyId', 'name')
      .populate('orderId', 'total status paymentMethod items createdAt')
      .populate('orderIds', 'total status paymentMethod items createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await Claim.countDocuments(query);
    
    res.json({
      claims,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching claims for insurance:', error);
    res.status(500).json({ message: 'Error fetching claims', error: error.message });
  }
});

// Get a single claim
router.get('/:claimId', async (req, res) => {
  try {
    const claim = await Claim.findById(req.params.claimId)
      .populate('customerId', 'name phone')
      .populate('insuranceCompanyId', 'name nameAr email phone coveragePercentage maxCoverageAmount')
      .populate('orderId')
      .populate('orderIds')
      .populate('pharmacyId', 'name phone email');
    
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }
    
    res.json(claim);
  } catch (error) {
    console.error('Error fetching claim:', error);
    res.status(500).json({ message: 'Error fetching claim', error: error.message });
  }
});

// Create a new claim
router.post('/', async (req, res) => {
  try {
    const { 
      pharmacyId, 
      customerId, 
      insuranceCompanyId, 
      orderId,
      orderIds, // Support multiple orders
      claimAmount, 
      description,
      createdBy 
    } = req.body;
    
    // Handle both single orderId and multiple orderIds
    let orderIdsArray = [];
    if (orderIds && Array.isArray(orderIds) && orderIds.length > 0) {
      orderIdsArray = orderIds;
    } else if (orderId) {
      orderIdsArray = [orderId];
    }
    
    if (orderIdsArray.length === 0) {
      return res.status(400).json({ message: 'At least one order is required' });
    }
    
    // Validate all orders exist and are insurance-paid
    const orders = await Order.find({ _id: { $in: orderIdsArray } });
    if (orders.length !== orderIdsArray.length) {
      return res.status(404).json({ message: 'One or more orders not found' });
    }
    
    const nonInsuranceOrders = orders.filter(o => o.paymentMethod !== 'Insurance');
    if (nonInsuranceOrders.length > 0) {
      return res.status(400).json({ message: 'All orders must be paid by insurance' });
    }
    
    // Validate customer exists
    const customer = await PharmacyCustomer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    // Validate insurance company exists
    const insuranceCompany = await InsuranceCompany.findById(insuranceCompanyId);
    if (!insuranceCompany) {
      return res.status(404).json({ message: 'Insurance company not found' });
    }
    
    // Calculate patient portion based on coverage percentage
    const coveragePercentage = insuranceCompany.coveragePercentage || 80;
    const patientPortion = claimAmount * ((100 - coveragePercentage) / 100);
    
    const claim = new Claim({
      pharmacyId,
      customerId,
      insuranceCompanyId,
      orderId: orderIdsArray[0], // Keep first order for backward compatibility
      orderIds: orderIdsArray,
      claimAmount,
      patientPortion,
      description,
      createdBy,
      status: 'pending'
    });
    
    await claim.save();
    
    // Update insurance company pending amount
    await InsuranceCompany.findByIdAndUpdate(insuranceCompanyId, {
      $inc: { totalClaims: 1, pendingAmount: claimAmount }
    });
    
    // Populate and return
    const populatedClaim = await Claim.findById(claim._id)
      .populate('customerId', 'name phone')
      .populate('insuranceCompanyId', 'name nameAr')
      .populate('orderId', 'total status paymentMethod createdAt')
      .populate('orderIds', 'total status paymentMethod createdAt');
    
    res.status(201).json(populatedClaim);
  } catch (error) {
    console.error('Error creating claim:', error);
    res.status(500).json({ message: 'Error creating claim', error: error.message });
  }
});

// Update claim status (for insurance company)
router.put('/:claimId/status', async (req, res) => {
  try {
    const { claimId } = req.params;
    const { status, approvedAmount, rejectionReason, reviewedBy } = req.body;
    
    const claim = await Claim.findById(claimId);
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
      
      // Update insurance company financials
      await InsuranceCompany.findByIdAndUpdate(claim.insuranceCompanyId, {
        $inc: { 
          pendingAmount: -claim.claimAmount,
          totalPaid: updateData.approvedAmount
        }
      });
    } else if (status === 'rejected') {
      updateData.rejectionReason = rejectionReason;
      updateData.approvedAmount = 0;
      
      // Remove from pending
      await InsuranceCompany.findByIdAndUpdate(claim.insuranceCompanyId, {
        $inc: { pendingAmount: -claim.claimAmount }
      });
    } else if (status === 'paid') {
      updateData.paidAt = new Date();
    }
    
    const updatedClaim = await Claim.findByIdAndUpdate(claimId, updateData, { new: true })
      .populate('customerId', 'name phone')
      .populate('insuranceCompanyId', 'name nameAr')
      .populate('orderId', 'total status paymentMethod createdAt');
    
    res.json(updatedClaim);
  } catch (error) {
    console.error('Error updating claim status:', error);
    res.status(500).json({ message: 'Error updating claim', error: error.message });
  }
});

// Update claim details
router.put('/:claimId', async (req, res) => {
  try {
    const { claimId } = req.params;
    const { description, notes } = req.body;
    
    const claim = await Claim.findByIdAndUpdate(
      claimId,
      { description, notes },
      { new: true }
    )
      .populate('customerId', 'name phone')
      .populate('insuranceCompanyId', 'name nameAr')
      .populate('orderId', 'total status paymentMethod createdAt');
    
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }
    
    res.json(claim);
  } catch (error) {
    console.error('Error updating claim:', error);
    res.status(500).json({ message: 'Error updating claim', error: error.message });
  }
});

// Delete claim
router.delete('/:claimId', async (req, res) => {
  try {
    const claim = await Claim.findById(req.params.claimId);
    if (!claim) {
      return res.status(404).json({ message: 'Claim not found' });
    }
    
    // Only allow deletion of pending claims
    if (claim.status !== 'pending') {
      return res.status(400).json({ message: 'Can only delete pending claims' });
    }
    
    // Update insurance company pending amount
    await InsuranceCompany.findByIdAndUpdate(claim.insuranceCompanyId, {
      $inc: { totalClaims: -1, pendingAmount: -claim.claimAmount }
    });
    
    await Claim.findByIdAndDelete(req.params.claimId);
    
    res.json({ message: 'Claim deleted successfully' });
  } catch (error) {
    console.error('Error deleting claim:', error);
    res.status(500).json({ message: 'Error deleting claim', error: error.message });
  }
});

// Get claim statistics for a pharmacy
router.get('/pharmacy/:pharmacyId/stats', async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    
    const stats = await Claim.aggregate([
      { $match: { pharmacyId: require('mongoose').Types.ObjectId(pharmacyId) } },
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
      if (s._id === 'pending' || s._id === 'submitted' || s._id === 'under_review') {
        summary.pendingAmount += s.totalAmount;
      }
      if (s._id === 'rejected') {
        summary.rejectedCount = s.count;
      }
    });
    
    res.json(summary);
  } catch (error) {
    console.error('Error fetching claim stats:', error);
    res.status(500).json({ message: 'Error fetching stats', error: error.message });
  }
});

module.exports = router;
