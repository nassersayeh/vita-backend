const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Request = require('../models/MedicalExamRequest');
const Service = require('../models/LaboratoryService');
const { resolveTemplate } = require('../utils/laboratoryTemplates');
const { priceItem, requestAccounting, monthlyAccounts } = require('../utils/laboratoryAccounting');
const { usesLegacyClinicDashboard } = require('../utils/partnerAccess');
const { sendWhatsAppMessage, isWhatsAppReady } = require('../services/whatsappService');
const validId = id => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
const laboratoryFilter = { role: 'Lab', activationStatus: 'active', isPublic: { $ne: false }, clinicId: null, internalDepartment: { $in: ['', null] } };
async function findLaboratory(id) {
  const laboratory = await User.findOne({ ...laboratoryFilter, _id: id }).select('_id clinicId fullName mobileNumber').lean();
  return laboratory && !await usesLegacyClinicDashboard(laboratory) ? laboratory : null;
}
async function notifyLaboratory(laboratory, request, sender) {
  try {
    if (!laboratory?.mobileNumber || !await isWhatsAppReady()) return;
    const patient = sender.role === 'User' ? sender : await User.findById(request.patientId).select('fullName').lean();
    const origin = sender.role === 'User' ? 'طلب مباشر من المريض' : `الطبيب المحوّل: ${sender.fullName}`;
    const message = `🔔 *طلب فحوصات جديد عبر فيتا*\n\nالمختبر: ${laboratory.fullName}\n${origin}\nالمريض: ${patient?.fullName || 'مريض'}\nالفحوصات المطلوبة: ${(request.tests || []).join('، ')}\nرقم الطلب: ${request._id}\n\nيرجى الدخول إلى لوحة المختبر لمراجعة الطلب.\nhttps://www.vita.ps/login`;
    await sendWhatsAppMessage(laboratory.mobileNumber, message);
  } catch (error) {
    console.warn(`Laboratory request WhatsApp notification failed for laboratory ${laboratory?._id}:`, error.message);
  }
}
router.use(auth);
router.use(async (req, res, next) => {
  try {
    if (req.user.role === 'User') {
      const allowed = (req.method === 'GET' && ['/', '/laboratories', '/services/catalog'].includes(req.path)) || (req.method === 'POST' && req.path === '/patient');
      if (!allowed) return res.status(403).json({ message: 'غير مصرح بهذا الإجراء.' });
    } else if (!['Doctor', 'Lab'].includes(req.user.role) || await usesLegacyClinicDashboard(req.user)) return res.status(403).json({ message: 'غير مصرح بهذا الإجراء.' });
    if (req.user.role === 'Lab' && !(await User.exists({ ...laboratoryFilter, _id: req.user._id }))) return res.status(403).json({ message: 'الحساب ليس مختبراً مستقلاً معتمداً.' });
    res.set('Cache-Control', 'no-store'); next();
  } catch { res.status(503).json({ message: 'تعذر التحقق من الحساب.' }); }
});
const doctorOnly = (req, res, next) => req.user.role === 'Doctor' ? next() : res.status(403).json({ message: 'للطبيب فقط.' });
router.get('/laboratories', (req, res, next) => ['Doctor', 'User'].includes(req.user.role) ? next() : res.status(403).json({ message: 'غير مصرح بهذا الإجراء.' }), async (req, res) => {
  try {
    const candidates = await User.find(laboratoryFilter).select('fullName city address clinicId').sort({ fullName: 1 }).lean();
    const eligible = await Promise.all(candidates.map(async lab => await usesLegacyClinicDashboard(lab) ? null : lab));
    res.json({ laboratories: eligible.filter(Boolean) });
  }
  catch { res.status(500).json({ message: 'تعذر تحميل المختبرات.' }); }
});
router.get('/', async (req, res) => {
  try {
    const filter = { [req.user.role === 'Lab' ? 'laboratoryId' : req.user.role === 'User' ? 'patientId' : 'doctorId']: req.user._id, deletedAt: null };
    if (req.query.patientId) {
      if (!validId(req.query.patientId)) return res.status(400).json({ message: 'معرّف المريض غير صحيح.' });
      if (req.user.role === 'User' && req.query.patientId !== String(req.user._id)) return res.status(403).json({ message: 'غير مصرح بهذا الإجراء.' });
      filter.patientId = req.query.patientId;
    }
    const paginated = req.query.page !== undefined;
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit) || (paginated ? 15 : 100))));
    if (req.query.status && ['pending', 'in_progress', 'completed'].includes(req.query.status)) filter.status = req.query.status;
    else if (req.query.activeOnly === 'true') filter.status = { $in: ['pending', 'in_progress'] };
    if (req.query.search) {
      const escaped = String(req.query.search).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const people = await User.find({ $or: [{ fullName: { $regex: escaped, $options: 'i' } }, { idNumber: { $regex: escaped, $options: 'i' } }] }).select('_id').lean();
      filter.$or = [{ patientId: { $in: people.map(p => p._id) } }, { doctorId: { $in: people.map(p => p._id) } }, { tests: { $regex: escaped, $options: 'i' } }];
    }
    const query = Request.find(filter).select(req.user.role === 'Lab' ? '+pricing +totalCost +resultDraft' : '-pricing -totalCost -resultDraft').populate('laboratoryId', 'fullName').populate('patientId', 'fullName idNumber mobileNumber birthdate sex').populate('doctorId', 'fullName').sort({ createdAt: -1 });
    if (paginated) query.skip((page - 1) * limit);
    const requests = await query.limit(limit).lean();
    const output = req.user.role === 'Lab' ? requests.map(request => ({ ...request, accounting: requestAccounting(request) })) : requests;
    const pagination = paginated ? { page, total: await Request.countDocuments(filter), limit } : undefined;
    if (pagination) pagination.totalPages = Math.max(1, Math.ceil(pagination.total / limit));
    res.json({ requests: output, pagination });
  } catch { res.status(500).json({ message: 'تعذر تحميل الطلبات.' }); }
});
router.post('/patient', async (req, res) => {
  if (req.user.role !== 'User') return res.status(403).json({ message: 'للمريض فقط.' });
  try {
    const { laboratoryId, serviceIds, notes = '' } = req.body || {};
    if (!validId(laboratoryId) || !Array.isArray(serviceIds) || !serviceIds.length || serviceIds.length > 30 || serviceIds.some(id => !validId(id)) || new Set(serviceIds).size !== serviceIds.length || typeof notes !== 'string' || notes.length > 2000) return res.status(400).json({ message: 'اختر المختبر والفحوصات بشكل صحيح (بحد أقصى 30 فحصاً).' });
    const laboratory = await findLaboratory(laboratoryId);
    if (!laboratory) return res.status(400).json({ message: 'المختبر غير متاح لاستقبال الطلبات.' });
    const services = await Service.find({ _id: { $in: serviceIds }, laboratoryId, isActive: true }).select('_id name price').lean();
    if (services.length !== serviceIds.length) return res.status(400).json({ message: 'بعض الفحوصات لم تعد متاحة لدى هذا المختبر. أعد اختيار الفحوصات.' });
    const byId = new Map(services.map(service => [String(service._id), service]));
    const selected = serviceIds.map(id => byId.get(id));
    if (selected.some(service => !service || !Number.isFinite(service.price) || service.price < 0)) return res.status(400).json({ message: 'تعذر التحقق من أسعار الفحوصات.' });
    const pricing = selected.map(service => priceItem({ name: service.name, price: service.price }));
    const totalCost = Math.round(pricing.reduce((sum, item) => sum + item.price, 0) * 100) / 100;
    const created = await Request.create({ source: 'patient', patientId: req.user._id, laboratoryId, referredAt: new Date(), referredBy: req.user._id, tests: selected.map(service => service.name), pricing, totalCost, notes: notes.trim(), status: 'pending' });
    await notifyLaboratory(laboratory, created, req.user);
    res.status(201).json({ request: { _id: created._id, laboratoryId, tests: created.tests, status: created.status, totalCost, createdAt: created.createdAt } });
  } catch { res.status(500).json({ message: 'تعذر إرسال طلب الفحوصات.' }); }
});
router.post('/', doctorOnly, async (req, res) => {
  try {
    const { patientId, laboratoryId, tests, notes = '' } = req.body || {};
    if (!validId(patientId) || !Array.isArray(tests) || !tests.length || tests.length > 30 || tests.some(test => typeof test !== 'string' || !test.trim() || test.length > 200) || typeof notes !== 'string' || notes.length > 2000) return res.status(400).json({ message: 'اختر المريض وأدخل أسماء الفحوصات بشكل صحيح.' });
    if (!(req.user.patients || []).some(id => String(id) === patientId) || !await User.exists({ _id: patientId, role: 'User' })) return res.status(403).json({ message: 'المريض غير مرتبط بحسابك.' });
    const laboratory = laboratoryId && validId(laboratoryId) ? await findLaboratory(laboratoryId) : null;
    if (laboratoryId && !laboratory) return res.status(400).json({ message: 'اختر مختبراً مستقلاً معتمداً.' });
    const request = await Request.create({ doctorId: req.user._id, patientId, laboratoryId: laboratoryId || null, ...(laboratoryId ? { referredAt: new Date(), referredBy: req.user._id } : {}), tests: [...new Set(tests.map(test => test.trim()))], notes: notes.trim(), status: laboratoryId ? 'pending' : 'awaiting_laboratory' });
    if (laboratory) await notifyLaboratory(laboratory, request, req.user);
    const publicRequest = request.toObject ? request.toObject() : { ...request }; delete publicRequest.pricing; delete publicRequest.totalCost; delete publicRequest.resultDraft;
    res.status(201).json({ request: publicRequest });
  } catch { res.status(500).json({ message: 'تعذر حفظ طلب الفحص.' }); }
});
router.patch('/:id/send', doctorOnly, async (req, res) => {
  try {
    const { laboratoryId } = req.body || {};
    if (!validId(req.params.id) || !validId(laboratoryId)) return res.status(400).json({ message: 'اختر مختبراً مستقلاً معتمداً.' });
    const laboratory = await findLaboratory(laboratoryId);
    if (!laboratory) return res.status(400).json({ message: 'اختر مختبراً مستقلاً معتمداً.' });
    const request = await Request.findOneAndUpdate({ _id: req.params.id, deletedAt: null, doctorId: req.user._id, status: 'awaiting_laboratory', laboratoryId: null }, { $set: { laboratoryId, status: 'pending', referredAt: new Date(), referredBy: req.user._id } }, { new: true });
    if (!request) return res.status(409).json({ message: 'الطلب غير متاح للإرسال.' });
    await notifyLaboratory(laboratory, request, req.user);
    const output = request.toObject ? request.toObject() : { ...request };
    if (req.user.role !== 'Lab') { delete output.pricing; delete output.totalCost; delete output.resultDraft; }
    res.json({ request: output });
  } catch { res.status(500).json({ message: 'تعذر إرسال الطلب.' }); }
});
router.patch('/:id/complete', async (req, res) => {
  try {
    if (req.user.role !== 'Lab') return res.status(403).json({ message: 'للمختبر فقط.' });
    if (!validId(req.params.id) || (req.body?.results !== undefined && (typeof req.body.results !== 'string' || req.body.results.length > 10000))) return res.status(400).json({ message: 'أدخل نتائج الفحص.' });
    const request = await Request.findOneAndUpdate({ _id: req.params.id, deletedAt: null, laboratoryId: req.user._id, status: { $in: ['pending', 'in_progress'] } }, { $set: { status: 'completed', results: (req.body.results || '').trim(), completedAt: new Date() } }, { new: true });
    if (!request) return res.status(404).json({ message: 'الطلب غير متاح.' });
    res.json({ request });
  } catch { res.status(500).json({ message: 'تعذر حفظ النتائج.' }); }
});

const labOnly = (req, res, next) => req.user.role === 'Lab' ? next() : res.status(403).json({ message: 'Laboratory only.' });
router.get('/services/catalog', async (req, res) => {
  try {
    const laboratoryId = req.user.role === 'Lab' ? req.user._id : req.query.laboratoryId;
    if (!validId(String(laboratoryId)) || (req.user.role !== 'Lab' && !await findLaboratory(laboratoryId))) return res.status(400).json({ message: 'Invalid laboratory.' });
    const filter = { laboratoryId, isActive: true };
    const paginated = req.query.page !== undefined;
    const requestedPage = Number(req.query.page);
    const requestedLimit = Number(req.query.limit ?? 15);
    if (paginated && (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || !Number.isSafeInteger(requestedLimit) || requestedLimit < 1)) return res.status(400).json({ message: 'Invalid pagination.' });
    const limit = Math.min(100, requestedLimit);
    const total = paginated ? await Service.countDocuments(filter) : undefined;
    const totalPages = paginated ? Math.max(1, Math.ceil(total / limit)) : undefined;
    const page = paginated ? Math.min(requestedPage, totalPages) : undefined;
    const query = Service.find(filter).select(req.user.role === 'Lab' ? '' : req.user.role === 'User' ? '_id name price category' : '-price -fields -normalRange -unit').sort({ category: 1, name: 1, _id: 1 });
    if (paginated) query.skip((page - 1) * limit).limit(limit);
    const services = await query.lean();
    res.json({ services: req.user.role === 'Lab' ? services.map(resolveTemplate) : services, ...(paginated ? { pagination: { page, limit, total, totalPages } } : {}) });
  } catch { res.status(500).json({ message: 'Failed to load services.' }); }
});
router.post('/services/catalog', labOnly, async (req, res) => {
  try {
    const { name, price, category = 'Routine', fields = [], unit = '', normalRange = '' } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || typeof price !== 'number' || !Number.isFinite(price) || price < 0 || !Array.isArray(fields) || fields.length > 100 || fields.some(f => !f || typeof f.label !== 'string' || !f.label.trim() || f.label.length > 120)) return res.status(400).json({ message: 'Invalid service or fields.' });
    if (new Set(fields.map(f => f.label.trim().toLowerCase())).size !== fields.length) return res.status(400).json({ message: 'Field labels must be unique.' });
    if (new Set(fields.map(f => String(f.key || f.label).trim())).size !== fields.length) return res.status(400).json({ message: 'Field keys must be unique.' });
    const service = await Service.findOneAndUpdate({ laboratoryId: req.user._id, name: name.trim() }, { $set: { price, category: String(category).slice(0,80), fields: fields.map(f => ({ label: f.label.trim(), key: String(f.key || f.label).slice(0,120), type: ['text','number','select','textarea'].includes(f.type) ? f.type : 'text', options: Array.isArray(f.options) ? f.options.slice(0,50).map(v => String(v).slice(0,120)) : [], unit: String(f.unit || '').slice(0,80), normalRange: String(f.normalRange || '').slice(0,300) })), unit: String(unit).slice(0,80), normalRange: String(normalRange).slice(0,300), isActive: true } }, { new: true, upsert: true, runValidators: true });
    res.json({ service });
  } catch { res.status(500).json({ message: 'Failed to save service.' }); }
});
router.patch('/:id/pricing', labOnly, async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid request.' });
    const request = await Request.findOne({ _id: req.params.id, deletedAt: null, laboratoryId: req.user._id, status: { $in: ['pending', 'in_progress'] } });
    if (!request) return res.status(404).json({ message: 'Request unavailable.' });
    const items = req.body.items;
    if (!Array.isArray(items) || items.length !== request.tests.length || new Set(items.map(i => i?.name)).size !== request.tests.length || items.some(i => !i || !request.tests.includes(i.name) || typeof i.price !== 'number' || !Number.isFinite(i.price) || i.price < 0 || (i.discountPercentage !== undefined && (typeof i.discountPercentage !== 'number' || !Number.isFinite(i.discountPercentage) || i.discountPercentage < 0 || i.discountPercentage > 100)))) return res.status(400).json({ message: 'Price every requested test.' });
    // Each new name becomes a service only in this laboratory; preserve existing templates.
    for (const item of items) await Service.updateOne({ laboratoryId: req.user._id, name: item.name }, { $setOnInsert: { price: item.price, category: 'Custom', fields: [], isActive: true } }, { upsert: true, runValidators: true });
    request.pricing = items.map(i => priceItem({ ...i, originalCost: i.price }));
    request.totalCost = Math.round(request.pricing.reduce((sum,i) => sum + i.price, 0) * 100) / 100;
    const updated = await Request.findOneAndUpdate({ _id: request._id, deletedAt: null, laboratoryId: req.user._id, status: { $in: ['pending', 'in_progress'] }, ...(request.updatedAt ? { updatedAt: request.updatedAt } : {}) }, { $set: { pricing: request.pricing, totalCost: request.totalCost } }, { new: true, runValidators: true });
    if (!updated) return res.status(409).json({ message: 'Request changed; reload before pricing.' });
    res.json({ request: updated });
  } catch { res.status(500).json({ message: 'Failed to price request.' }); }
});


router.get('/dashboard/stats', labOnly, async (req, res) => {
  try {
    const owner = { laboratoryId: req.user._id, deletedAt: null };
    const [pending, inProgress, completed] = await Promise.all(['pending', 'in_progress', 'completed'].map(status => Request.countDocuments({ ...owner, status })));
    res.json({ pending, inProgress, completed });
  } catch { res.status(500).json({ message: 'Failed to load laboratory statistics.' }); }
});
router.get('/:id/details', labOnly, async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid request.' });
    const request = await Request.findOne({ _id: req.params.id, deletedAt: null, laboratoryId: req.user._id }).select('+resultDraft').populate('patientId', 'fullName idNumber mobileNumber birthdate sex').populate('doctorId', 'fullName').lean();
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    res.json({ request: { ...request, accounting: requestAccounting(request) } });
  } catch { res.status(500).json({ message: 'Failed to load request.' }); }
});
router.get('/accounts/monthly', labOnly, async (req, res) => {
  try {
    const now = new Date(Date.now() + 3 * 3600000);
    const year = Number(req.query.year || now.getUTCFullYear());
    const month = Number(req.query.month || now.getUTCMonth() + 1);
    if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return res.status(400).json({ message: 'Invalid accounting period.' });
    const range = { $gte: new Date(Date.UTC(year, month - 1, 1) - 3 * 3600000), $lt: new Date(Date.UTC(year, month, 1) - 3 * 3600000) };
    const requests = await Request.find({ laboratoryId: req.user._id, deletedAt: null, status: 'completed', $or: [{ completedAt: range }, { completedAt: null, updatedAt: range }] })
      .populate('patientId', 'fullName idNumber').populate('doctorId', 'fullName').sort({ completedAt: -1, createdAt: -1 }).lean();
    res.json({ ...monthlyAccounts(requests), period: { year, month, timezone: 'Asia/Riyadh' }, commissionPercent: 5 });
  } catch { res.status(500).json({ message: 'Failed to load laboratory accounts.' }); }
});
router.patch('/:id/status', labOnly, async (req, res) => {
  try {
    if (!validId(req.params.id) || req.body.status !== 'in_progress') return res.status(400).json({ message: 'Invalid status.' });
    const request = await Request.findOneAndUpdate({ _id: req.params.id, deletedAt: null, laboratoryId: req.user._id, status: 'pending' }, { $set: { status: 'in_progress' } }, { new: true });
    if (!request) return res.status(409).json({ message: 'Request is no longer pending.' });
    res.json({ request });
  } catch { res.status(500).json({ message: 'Failed to update request.' }); }
});


router.patch('/:id/draft', labOnly, async (req, res) => {
  try {
    if (!validId(req.params.id) || !Array.isArray(req.body.resultDraft) || req.body.resultDraft.length > 30 || req.body.resultDraft.some(item => !item || typeof item.name !== 'string' || typeof item.value !== 'string' || item.value.length > 20000) || new Set(req.body.resultDraft.map(item => item.name)).size !== req.body.resultDraft.length) return res.status(400).json({ message: 'Invalid result draft.' });
    const request = await Request.findOne({ _id: req.params.id, laboratoryId: req.user._id, deletedAt: null, status: { $in: ['pending','in_progress'] } });
    if (!request) return res.status(404).json({ message: 'Request unavailable.' });
    if (req.body.resultDraft.some(item => !request.tests.includes(item.name))) return res.status(400).json({ message: 'Draft test is not part of this request.' });
    const updated = await Request.findOneAndUpdate({ _id: request._id, laboratoryId: req.user._id, deletedAt: null, status: { $in: ['pending','in_progress'] } }, { $set: { resultDraft: req.body.resultDraft.map(item => ({ name: item.name, value: item.value })) } }, { new: true }).select('+resultDraft');
    if (!updated) return res.status(409).json({ message: 'Request changed; reload.' });
    res.json({ request: updated });
  } catch { res.status(500).json({ message: 'Failed to save result draft.' }); }
});
router.delete('/:id', labOnly, async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid request.' });
    const request = await Request.findOneAndUpdate({ _id: req.params.id, laboratoryId: req.user._id, deletedAt: null }, { $set: { deletedAt: new Date() } }, { new: true });
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    res.json({ deleted: true });
  } catch { res.status(500).json({ message: 'Failed to delete request.' }); }
});

module.exports = router;
