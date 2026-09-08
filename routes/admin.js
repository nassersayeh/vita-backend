const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const auth = require('../middleware/auth');
const User = require('../models/User');
const mongoose = require('mongoose');
const LabRequest = require('../models/LabRequest');
const MedicalRecord = require('../models/MedicalRecord');
const PharmacyPrescriptionQuote = require('../models/PharmacyPrescriptionQuote');
const PartnerCommissionSettlement = require('../models/PartnerCommissionSettlement');

const requireAdmin = (req, res, next) => {
  if (!['Admin', 'Superadmin'].includes(req.user?.role)) return res.status(403).json({ message: 'Admin access required' });
  next();
};

router.get('/patient-ordering-pharmacies', auth, requireAdmin, async (req, res) => {
  const pharmacies = await User.find({ role: 'Pharmacy' }).select('fullName city address activationStatus patientOrderingEnabled').sort({ fullName: 1 }).lean();
  res.json({ pharmacies });
});

router.put('/patient-ordering-pharmacies/:pharmacyId', auth, requireAdmin, async (req, res) => {
  const pharmacy = await User.findOneAndUpdate(
    { _id: req.params.pharmacyId, role: 'Pharmacy' },
    { $set: { patientOrderingEnabled: req.body.enabled === true } },
    { new: true, runValidators: true }
  ).select('fullName city address activationStatus patientOrderingEnabled');
  if (!pharmacy) return res.status(404).json({ message: 'Pharmacy not found' });
  res.json({ pharmacy });
});

const commissionSource = {
  radiology: {
    Model: LabRequest, rate: 5, providerField: 'labId', grossField: 'totalCost', commissionField: 'vitaCommissionAmount',
    base: { status: 'completed', sourceChannel: 'vita_partner_network', vitaSettlement: null },
  },
  pharmacy: {
    Model: PharmacyPrescriptionQuote, rate: 2, providerField: 'pharmacy', grossField: 'discountedTotal', commissionField: 'vitaCommissionTotal',
    base: { status: { $in: ['priced', 'dispensed'] }, vitaSettlement: null },
  },
  dentist: {
    Model: MedicalRecord, rate: 5, providerField: 'doctor', grossField: 'billing.paidAmount', commissionField: 'vitaCommissionAmount',
    base: { $or: [{ partnerSourceChannel: 'vita_partner_network' }, { partnerSourceChannel: { $exists: false }, 'billing.totalAmount': { $exists: true } }], vitaSettlement: null, 'billing.paidAmount': { $gt: 0 }, vitaCommissionAmount: { $gt: 0 } },
  },
};

const summarizePendingCommissions = async () => {
  const summaries = await Promise.all(Object.entries(commissionSource).map(async ([providerType, config]) => {
    const rows = await config.Model.aggregate([
      { $match: config.base },
      { $group: { _id: `$${config.providerField}`, grossAmount: { $sum: `$${config.grossField}` }, vitaCommissionAmount: { $sum: `$${config.commissionField}` }, sourceCount: { $sum: 1 } } },
      { $match: { vitaCommissionAmount: { $gt: 0 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'provider' } },
      { $unwind: '$provider' },
      { $project: { providerId: '$_id', _id: 0, providerName: '$provider.fullName', city: '$provider.city', grossAmount: 1, vitaCommissionAmount: 1, sourceCount: 1 } },
    ]);
    return rows.map((row) => ({ ...row, providerType, commissionRate: config.rate }));
  }));
  return summaries.flat().sort((a, b) => b.vitaCommissionAmount - a.vitaCommissionAmount);
};

router.get('/partner-commissions', auth, requireAdmin, async (req, res) => {
  try {
    const year = Math.min(2100, Math.max(2020, Number(req.query.year) || new Date().getFullYear()));
    const month = Math.min(12, Math.max(1, Number(req.query.month) || new Date().getMonth() + 1));
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));
    const [pending, settlements] = await Promise.all([
      summarizePendingCommissions(),
      PartnerCommissionSettlement.find({ receivedAt: { $gte: from, $lt: to } })
        .populate('provider', 'fullName city role specialty').populate('receivedBy', 'fullName').sort({ receivedAt: -1 }).lean(),
    ]);
    const totals = pending.reduce((value, row) => ({ grossAmount: value.grossAmount + Number(row.grossAmount || 0), vitaCommissionAmount: value.vitaCommissionAmount + Number(row.vitaCommissionAmount || 0) }), { grossAmount: 0, vitaCommissionAmount: 0 });
    const monthlyTotals = settlements.reduce((value, row) => ({ grossAmount: value.grossAmount + Number(row.grossAmount || 0), vitaCommissionAmount: value.vitaCommissionAmount + Number(row.vitaCommissionAmount || 0), settlements: value.settlements + 1 }), { grossAmount: 0, vitaCommissionAmount: 0, settlements: 0 });
    res.json({ pending, settlements, totals, monthlyTotals, period: { year, month } });
  } catch (error) { res.status(500).json({ message: 'Failed to load partner commissions.' }); }
});

router.post('/partner-commissions/receive', auth, requireAdmin, async (req, res) => {
  const config = commissionSource[req.body.providerType];
  if (!config || !mongoose.isValidObjectId(req.body.providerId)) return res.status(400).json({ message: 'Invalid provider settlement.' });
  const settlementId = new mongoose.Types.ObjectId();
  const providerId = new mongoose.Types.ObjectId(req.body.providerId);
  const filter = { ...config.base, [config.providerField]: providerId };
  try {
    const sourceRows = await config.Model.find(filter).select(`${config.grossField} ${config.commissionField}`).lean();
    const eligible = sourceRows.filter((row) => Number(config.grossField.split('.').reduce((value, key) => value?.[key], row) || 0) >= 0 && Number(row[config.commissionField] || 0) > 0);
    if (!eligible.length) return res.status(409).json({ message: 'No pending commission remains for this provider.' });
    const sourceIds = eligible.map((row) => row._id);
    await config.Model.updateMany({ _id: { $in: sourceIds }, vitaSettlement: null }, { $set: { vitaSettlement: settlementId } });
    const settledRows = await config.Model.find({ _id: { $in: sourceIds }, vitaSettlement: settlementId }).select(`${config.grossField} ${config.commissionField}`).lean();
    if (!settledRows.length) return res.status(409).json({ message: 'This balance was already received.' });
    const grossAmount = settledRows.reduce((sum, row) => sum + Number(config.grossField.split('.').reduce((value, key) => value?.[key], row) || 0), 0);
    const vitaCommissionAmount = settledRows.reduce((sum, row) => sum + Number(row[config.commissionField] || 0), 0);
    const settlement = await PartnerCommissionSettlement.create({ _id: settlementId, provider: providerId, providerType: req.body.providerType, commissionRate: config.rate, grossAmount: Number(grossAmount.toFixed(2)), vitaCommissionAmount: Number(vitaCommissionAmount.toFixed(2)), sourceCount: settledRows.length, sourceIds: settledRows.map((row) => row._id), receivedBy: req.user._id, receivedAt: new Date() });
    res.status(201).json({ settlement });
  } catch (error) {
    await config.Model.updateMany({ vitaSettlement: settlementId }, { $set: { vitaSettlement: null } }).catch(() => {});
    res.status(500).json({ message: 'Failed to receive partner commission.' });
  }
});

// Get pending approvals
router.get('/pending-approvals', adminController.getPendingApprovals);

// Approve or reject user
router.put('/approve-user/:userId', adminController.approveUser);

// Get all users with filtering
router.get('/users', adminController.getAllUsers);

// Send targeted notification
router.post('/notifications', adminController.sendNotification);

// Get dashboard analytics
router.get('/analytics', adminController.getDashboardAnalytics);

// Landing page analytics
router.get('/landing-analytics', adminController.getLandingAnalytics);

// Points settings
router.get('/points/settings', adminController.getPointSettings);
router.put('/points/settings', adminController.updatePointSettings);

// Get admin stats (new route)
router.get('/stats', adminController.getDashboardAnalytics);

// Get potential clients from external medical/pharmacy directories
router.get('/potential-clients', adminController.getPotentialClients);

// Update potential client follow-up status
router.put('/potential-clients/status', adminController.updatePotentialClientStatus);

// Demo requests submitted from landing page
router.get('/demo-requests', adminController.getDemoRequests);
router.put('/demo-requests/:id/status', adminController.updateDemoRequestStatus);

// Get notification history
router.get('/notifications/history', adminController.getNotificationHistory);

// Delete user
router.delete('/users/:userId', adminController.deleteUser);

// Get user counts by role
router.get('/user-stats', adminController.getUserStats);

// List users with trial status (active, ended, paid/unpaid)
router.get('/trials', adminController.getTrialUsers);

// Extend trial for a user
router.put('/user/:id/trial', adminController.extendTrial);

// Update payment status for a user
router.put('/user/:id/payment', adminController.updatePaymentStatus);


// Create a new user (admin only)
router.post('/users/create', adminController.createUser);

// Search users for gift points modal
router.get('/users/search-for-gift', adminController.searchUsersForGift);

// Get user by ID
router.get('/users/:userId', adminController.getUserById);

// Update user data
router.put('/users/:userId', adminController.updateUser);

// Get revenue by month
router.get('/revenue/:year/:month', adminController.getRevenueByMonth);

// Gift points to users
router.post('/gift-points', adminController.giftPoints);

// ======= Insurance Payments (Pharmacy claims to admin) =======
router.get('/insurance-payments', async (req, res) => {
  try {
    const InsuranceClaim = require('../models/InsuranceClaim');
    // Group by pharmacy - only claims where service fee was actually paid (via card)
    const grouped = await InsuranceClaim.aggregate([
      { $match: { servicePaymentStatus: 'paid' } },
      {
        $group: {
          _id: '$pharmacyId',
          pharmacyName: { $first: '$pharmacyName' },
          totalClaims: { $sum: 1 },
          totalClaimsValue: { $sum: '$claimsValue' },
          totalServiceFee: { $sum: '$serviceFee' },
          totalPaidServiceFee: { $sum: '$serviceFee' },
          paidClaims: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
          pendingClaims: { $sum: { $cond: [{ $ne: ['$status', 'paid'] }, 1, 0] } },
        }
      },
      { $sort: { totalPaidServiceFee: -1 } }
    ]);
    res.json({ pharmacies: grouped });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.get('/insurance-payments/:pharmacyId', async (req, res) => {
  try {
    const InsuranceClaim = require('../models/InsuranceClaim');
    const mongoose = require('mongoose');
    const claims = await InsuranceClaim.find({
      pharmacyId: new mongoose.Types.ObjectId(req.params.pharmacyId),
      servicePaymentStatus: 'paid',
    }).sort({ createdAt: -1 });
    res.json({ claims });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// ======= Subscriptions (Platform + Vita AI ChatBot) =======
router.get('/subscriptions', async (req, res) => {
  try {
    const User = require('../models/User');
    const now = new Date();

    // Platform subscriptions
    const platformSubs = await User.find({
      role: { $in: ['Pharmacy', 'Doctor'] },
      $or: [
        { subscriptionEndDate: { $ne: null } },
        { isPaid: true },
        { hasAcceptedOffer: true },
      ]
    }).select('name fullName clinicName role phone city subscriptionEndDate subscriptionPlanUnit subscriptionPlanValue lastPaymentAmount lastPaymentAt isPaid hasAcceptedOffer offerAcceptedAt trialEndDate').lean();

    // Vita AI subscriptions
    const aiSubs = await User.find({
      'vitatAI.isSubscribed': true,
    }).select('name fullName clinicName role phone city vitatAI').lean();

    // Vita AI trial users
    const aiTrials = await User.find({
      'vitatAI.hasAcceptedTrial': true,
      'vitatAI.isSubscribed': { $ne: true },
    }).select('name fullName clinicName role phone city vitatAI').lean();

    res.json({ platformSubs, aiSubs, aiTrials });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Insurance companies and oversight accounts for admin
router.get('/insurance-accounts', async (req, res) => {
  try {
    const InsuranceCompany = require('../models/InsuranceCompany');
    const OversightAccount = require('../models/OversightAccount');
    const [companies, oversight] = await Promise.all([
      InsuranceCompany.find({}).select('-password').sort({ createdAt: -1 }),
      OversightAccount.find({}).select('-password').sort({ createdAt: -1 }),
    ]);
    res.json({ companies, oversight });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.delete('/insurance-accounts/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    if (type === 'company') {
      const InsuranceCompany = require('../models/InsuranceCompany');
      await InsuranceCompany.findByIdAndDelete(id);
    } else {
      const OversightAccount = require('../models/OversightAccount');
      await OversightAccount.findByIdAndDelete(id);
    }
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
