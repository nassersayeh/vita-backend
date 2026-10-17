const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Request = require('../models/MedicalExamRequest');
const { usesLegacyClinicDashboard } = require('../utils/partnerAccess');
const validId = id => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
const laboratoryFilter = { role: 'Lab', activationStatus: 'active', isPublic: { $ne: false }, clinicId: null, internalDepartment: { $in: ['', null] } };
async function findLaboratory(id) {
  const laboratory = await User.findOne({ ...laboratoryFilter, _id: id }).select('_id clinicId').lean();
  return laboratory && !await usesLegacyClinicDashboard(laboratory) ? laboratory : null;
}
router.use(auth);
router.use(async (req, res, next) => {
  try {
    if (!['Doctor', 'Lab'].includes(req.user.role) || await usesLegacyClinicDashboard(req.user)) return res.status(403).json({ message: 'غير مصرح بهذا الإجراء.' });
    if (req.user.role === 'Lab' && !(await User.exists({ ...laboratoryFilter, _id: req.user._id }))) return res.status(403).json({ message: 'الحساب ليس مختبراً مستقلاً معتمداً.' });
    res.set('Cache-Control', 'no-store'); next();
  } catch { res.status(503).json({ message: 'تعذر التحقق من الحساب.' }); }
});
const doctorOnly = (req, res, next) => req.user.role === 'Doctor' ? next() : res.status(403).json({ message: 'للطبيب فقط.' });
router.get('/laboratories', doctorOnly, async (req, res) => {
  try {
    const candidates = await User.find(laboratoryFilter).select('fullName city address clinicId').sort({ fullName: 1 }).lean();
    const eligible = await Promise.all(candidates.map(async lab => await usesLegacyClinicDashboard(lab) ? null : lab));
    res.json({ laboratories: eligible.filter(Boolean) });
  }
  catch { res.status(500).json({ message: 'تعذر تحميل المختبرات.' }); }
});
router.get('/', async (req, res) => {
  try {
    const filter = req.user.role === 'Lab' ? { laboratoryId: req.user._id } : { doctorId: req.user._id };
    if (req.query.patientId) {
      if (!validId(req.query.patientId)) return res.status(400).json({ message: 'معرّف المريض غير صحيح.' });
      filter.patientId = req.query.patientId;
    }
    res.json({ requests: await Request.find(filter).populate('laboratoryId', 'fullName').populate('patientId', 'fullName idNumber').sort({ createdAt: -1 }).limit(100).lean() });
  } catch { res.status(500).json({ message: 'تعذر تحميل الطلبات.' }); }
});
router.post('/', doctorOnly, async (req, res) => {
  try {
    const { patientId, laboratoryId, tests, notes = '' } = req.body || {};
    if (!validId(patientId) || !Array.isArray(tests) || !tests.length || tests.length > 30 || tests.some(test => typeof test !== 'string' || !test.trim() || test.length > 200) || typeof notes !== 'string' || notes.length > 2000) return res.status(400).json({ message: 'اختر المريض وأدخل أسماء الفحوصات بشكل صحيح.' });
    if (!(req.user.patients || []).some(id => String(id) === patientId) || !await User.exists({ _id: patientId, role: 'User' })) return res.status(403).json({ message: 'المريض غير مرتبط بحسابك.' });
    if (laboratoryId && (!validId(laboratoryId) || !await findLaboratory(laboratoryId))) return res.status(400).json({ message: 'اختر مختبراً مستقلاً معتمداً.' });
    const request = await Request.create({ doctorId: req.user._id, patientId, laboratoryId: laboratoryId || null, tests: [...new Set(tests.map(test => test.trim()))], notes: notes.trim(), status: laboratoryId ? 'pending' : 'awaiting_laboratory' });
    res.status(201).json({ request });
  } catch { res.status(500).json({ message: 'تعذر حفظ طلب الفحص.' }); }
});
router.patch('/:id/send', doctorOnly, async (req, res) => {
  try {
    const { laboratoryId } = req.body || {};
    if (!validId(req.params.id) || !validId(laboratoryId) || !await findLaboratory(laboratoryId)) return res.status(400).json({ message: 'اختر مختبراً مستقلاً معتمداً.' });
    const request = await Request.findOneAndUpdate({ _id: req.params.id, doctorId: req.user._id, status: 'awaiting_laboratory', laboratoryId: null }, { $set: { laboratoryId, status: 'pending' } }, { new: true });
    if (!request) return res.status(409).json({ message: 'الطلب غير متاح للإرسال.' });
    res.json({ request });
  } catch { res.status(500).json({ message: 'تعذر إرسال الطلب.' }); }
});
router.patch('/:id/complete', async (req, res) => {
  try {
    if (req.user.role !== 'Lab') return res.status(403).json({ message: 'للمختبر فقط.' });
    if (!validId(req.params.id) || typeof req.body?.results !== 'string' || !req.body.results.trim() || req.body.results.length > 10000) return res.status(400).json({ message: 'أدخل نتائج الفحص.' });
    const request = await Request.findOneAndUpdate({ _id: req.params.id, laboratoryId: req.user._id, status: 'pending' }, { $set: { status: 'completed', results: req.body.results.trim(), completedAt: new Date() } }, { new: true });
    if (!request) return res.status(404).json({ message: 'الطلب غير متاح.' });
    res.json({ request });
  } catch { res.status(500).json({ message: 'تعذر حفظ النتائج.' }); }
});
module.exports = router;
