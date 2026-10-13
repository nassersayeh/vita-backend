const router = require('express').Router();
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const User = require('../models/User');
const { signup } = require('../controllers/authController');
const { validatePasswordPolicy } = require('../utils/passwordPolicy');
const { salesSignupLimiter, salesPasswordLimiter } = require('../middleware/authRateLimiter');
const { customerMetrics } = require('../services/salesMetrics');

router.use(auth, (req, res, next) => {
  if (req.user.role !== 'SalesManager') return res.status(403).json({ message: 'غير مصرح بهذا الإجراء.' });
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/customers', async (req, res) => {
  try {
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const filter = { salesManager: req.user._id, role: { $in: ['Doctor', 'Pharmacy'] } };
    const [customers, total] = await Promise.all([
      User.find(filter).select('fullName role specialty address city mobileNumber activationStatus createdAt')
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 25).limit(25).lean(),
      User.countDocuments(filter),
    ]);
    res.json({ customers: await customerMetrics(customers), total, page, pageSize: 25 });
  } catch (error) {
    console.error('Sales customer metrics failed:', error.message);
    res.status(500).json({ message: 'تعذر تحميل العملاء، حاول مرة أخرى.' });
  }
});

router.post('/customers', salesSignupLimiter, (req, res) => {
  if (!req.body || !['Doctor', 'Pharmacy'].includes(req.body.role)) {
    return res.status(400).json({ message: 'يمكن فتح حساب طبيب أو صيدلية فقط.' });
  }
  req.salesManagerId = req.user._id;
  return signup(req, res);
});

router.post('/password', salesPasswordLimiter, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || Buffer.byteLength(currentPassword) > 72 || validatePasswordPolicy(newPassword, req.user.fullName)) {
      return res.status(400).json({ message: 'كلمة المرور الجديدة يجب أن تكون ٨ أحرف على الأقل ولا تحتوي على الاسم.' });
    }
    if (!(await bcrypt.compare(currentPassword, req.user.password))) return res.status(400).json({ message: 'كلمة المرور الحالية غير صحيحة.' });
    if (currentPassword === newPassword) return res.status(400).json({ message: 'اختر كلمة مرور مختلفة.' });
    const password = await bcrypt.hash(newPassword, 12);
    const updated = await User.updateOne({ _id: req.user._id, password: req.user.password }, {
      $set: { password, passwordChangedAt: new Date() },
    });
    if (!updated.modifiedCount) return res.status(409).json({ message: 'تغيّرت الجلسة، سجّل الدخول مجدداً.' });
    res.json({ success: true, message: 'تم تغيير كلمة المرور. سجّل الدخول مجدداً.' });
  } catch {
    res.status(500).json({ message: 'تعذر تغيير كلمة المرور.' });
  }
});
module.exports = router;
