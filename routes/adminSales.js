// Mounted below auth in sales/team and below auth + requireAdmin in admin/sales.
const router = require('express').Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const { customerMetrics, teamCommissions } = require('../services/salesMetrics');
router.use((req, res, next) => {
  if (!['Admin', 'Superadmin', 'SalesTeamLead'].includes(req.user?.role)) return res.status(403).json({ message: 'غير مصرح بهذا الإجراء.' });
  res.set('Cache-Control', 'no-store');
  next();
});
// Only new provider registrations: no staff/admin roles or subscription renewals.
router.get('/join-requests', async (req, res) => {
  try {
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const filter = { activationStatus: 'pending', role: { $in: ['Doctor', 'Pharmacy', 'Lab', 'Institution', 'Hospital'] } };
    const [requests, total] = await Promise.all([
      User.find(filter).select('fullName email mobileNumber role specialty city address createdAt subscriptionPlanKey subscriptionBillingCycle subscriptionSelectedPrice paymentMethod')
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 25).limit(25).lean(),
      User.countDocuments(filter),
    ]);
    res.json({ requests, total, page, pageSize: 25 });
  } catch (error) {
    res.status(500).json({ message: 'تعذّر تحميل طلبات الانضمام.' });
  }
});
router.put('/join-requests/:userId/approve', (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.userId)) return res.status(400).json({ message: 'معرّف الطلب غير صحيح.' });
  req.body = { status: 'active', requestType: 'registration', adminId: req.user._id || req.user.id };
  return require('../controllers/adminController').approveUser(req, res);
});
router.get('/', async (req, res) => {
  try {
    const managers = await User.find({ role: 'SalesManager' }).select('fullName mobileNumber activationStatus').sort({ fullName: 1 }).lean();
    const rows = managers.map(manager => ({ ...manager, customerCount: 0, prescriptionCount: 0, radiologyCount: 0, appointmentCount: 0, labCount: 0, vitaCommission: 0 }));
    const byId = new Map(rows.map(row => [String(row._id), row]));
    // Walk every customer, independently of the paginated detail table.
    let lastId;
    while (managers.length) {
      const customers = await User.find({ salesManager: { $in: managers.map(manager => manager._id) }, role: { $in: ['Doctor', 'Pharmacy', 'User'] }, ...(lastId ? { _id: { $gt: lastId } } : {}) })
        .select('role salesManager').sort({ _id: 1 }).limit(250).lean();
      if (!customers.length) break;
      for (const customer of await customerMetrics(customers)) {
        const row = byId.get(String(customer.salesManager));
        row.customerCount++;
        for (const field of ['prescriptionCount', 'radiologyCount', 'appointmentCount', 'labCount']) row[field] += customer[field] || 0;
      }
      lastId = customers[customers.length - 1]._id;
      if (customers.length < 250) break;
    }
    const ids = managers.map(manager => manager._id);
    const [commissions, uniqueCommissions] = await Promise.all([
      teamCommissions(ids, { breakdown: true }), teamCommissions(ids, { breakdown: true, unique: true }),
    ]);
    for (const row of rows) Object.assign(row, commissions.get(String(row._id)) || { medicineCommission: 0, diagnosticCommission: 0, treatmentCommission: 0, vitaCommission: 0 });
    res.json({ managers: rows, totals: uniqueCommissions.get('null') || { medicineCommission: 0, diagnosticCommission: 0, treatmentCommission: 0, vitaCommission: 0 } });
  } catch (error) {
    console.error('Admin sales summary failed:', error.message);
    res.status(500).json({ message: 'تعذر تحميل إحصائيات المبيعات.' });
  }
});
// Clinical detail is restricted to administrators, even on the team-lead mount.
router.get('/:id/activity', async (req, res) => {
  if (!['Admin', 'Superadmin'].includes(req.user?.role)) return res.status(403).json({ message: 'Administrator access required.' });
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ message: 'Invalid sales manager ID.' });
  try {
    const manager = await User.findOne({ _id: new mongoose.Types.ObjectId(req.params.id), role: 'SalesManager' }).select('_id').lean();
    if (!manager) return res.status(404).json({ message: 'Sales manager not found.' });
    const { getAdminSalesActivity } = require('../services/adminSalesActivity');
    res.json(await getAdminSalesActivity(manager._id, req.query));
  } catch (error) {
    res.status(error.status === 400 ? 400 : 500).json({ message: error.status === 400 ? error.message : 'Could not load activity details.' });
  }
});
router.get('/:id/customers', async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ message: 'معرّف الموظفة غير صحيح.' });
    const manager = await User.findOne({ _id: new mongoose.Types.ObjectId(req.params.id), role: 'SalesManager' }).select('fullName mobileNumber activationStatus').lean();
    if (!manager) return res.status(404).json({ message: 'حساب موظفة المبيعات غير موجود.' });
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const filter = { salesManager: manager._id, role: { $in: ['Doctor', 'Pharmacy', 'User'] } };
    const [customers, total] = await Promise.all([
      User.find(filter).select('fullName role specialty address city mobileNumber activationStatus createdAt').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 25).limit(25).lean(),
      User.countDocuments(filter),
    ]);
    const [metrics, commissions] = await Promise.all([customerMetrics(customers), teamCommissions([manager._id])]);
    res.json({ manager, customers: metrics, vitaCommission: commissions.get(String(manager._id)) || 0, total, page, pageSize: 25 });
  } catch (error) {
    console.error('Admin sales customers failed:', error.message);
    res.status(500).json({ message: 'تعذر تحميل عملاء الموظفة.' });
  }
});
module.exports = router;
