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
router.get('/', async (req, res) => {
  try {
    const managers = await User.find({ role: 'SalesManager' }).select('fullName mobileNumber activationStatus').sort({ fullName: 1 }).lean();
    const rows = managers.map(manager => ({ ...manager, customerCount: 0, prescriptionCount: 0, radiologyCount: 0, appointmentCount: 0, labCount: 0, vitaCommission: 0 }));
    const byId = new Map(rows.map(row => [String(row._id), row]));
    // Walk every customer, independently of the paginated detail table.
    let lastId;
    while (managers.length) {
      const customers = await User.find({ salesManager: { $in: managers.map(manager => manager._id) }, role: { $in: ['Doctor', 'Pharmacy'] }, ...(lastId ? { _id: { $gt: lastId } } : {}) })
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
    const commissions = await teamCommissions(managers.map(manager => manager._id));
    for (const row of rows) row.vitaCommission = commissions.get(String(row._id)) || 0;
    res.json({ managers: rows });
  } catch (error) {
    console.error('Admin sales summary failed:', error.message);
    res.status(500).json({ message: 'تعذر تحميل إحصائيات المبيعات.' });
  }
});
router.get('/:id/customers', async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ message: 'معرّف الموظفة غير صحيح.' });
    const manager = await User.findOne({ _id: new mongoose.Types.ObjectId(req.params.id), role: 'SalesManager' }).select('fullName mobileNumber activationStatus').lean();
    if (!manager) return res.status(404).json({ message: 'حساب موظفة المبيعات غير موجود.' });
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const filter = { salesManager: manager._id, role: { $in: ['Doctor', 'Pharmacy'] } };
    const [customers, total] = await Promise.all([
      User.find(filter).select('fullName role specialty address city mobileNumber activationStatus createdAt').sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 25).limit(25).lean(),
      User.countDocuments(filter),
    ]);
    res.json({ manager, customers: await customerMetrics(customers), total, page, pageSize: 25 });
  } catch (error) {
    console.error('Admin sales customers failed:', error.message);
    res.status(500).json({ message: 'تعذر تحميل عملاء الموظفة.' });
  }
});
module.exports = router;
