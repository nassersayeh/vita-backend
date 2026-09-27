const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const router = express.Router();
const User = require('../models/User');
const Rx = require('../models/ControlledPrescription');
const Allocation = require('../models/ControlledAllocation');
const Access = require('../models/ControlledAccess');
const Catalogue = require('../models/ControlledDrug');
const Drug = require('../models/Drug');
const Inventory = require('../models/PharmacyInventory');
const Quote = require('../models/ControlledQuote');
const Oversight = require('../models/OversightAccount');
const { signPrescription, verifyPrescription, requireIntegrity } = require('../utils/controlledIntegrity');
const { saveStandalonePrescription } = require('../utils/saveStandalonePrescription');
const { activePrescriptionFilter } = require('../utils/pharmacyPrescriptionPricing');
const { palestinianCountries, isPalestinian, canPractice, serialFor, validateControlledProducts } = require('../utils/controlledPolicy');
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Pragma', 'no-cache'); next(); });
router.use(require('../middleware/controlledAuth'));
router.use(require('../middleware/authRateLimiter').controlledLimiter);
router.use(require('../middleware/controlledSecurityLog'));
router.use((req, res, next) => {
  if (Object.values(req.query).some(value => typeof value !== 'string' || value.length > 200)) return res.status(400).json({ message: 'Invalid query.' });
  next();
});
router.use((req, res, next) => req.body && (typeof req.body !== 'object' || Array.isArray(req.body)) ? res.status(400).json({ message: 'Invalid payload.' }) : next());
const oversightRoles = ['medical_syndicate', 'pharmacy_syndicate', 'ministry_of_health'];
const allow = (...roles) => (req, res, next) => roles.includes(req.controlledActor.role) ? next() : res.status(403).json({ message: 'لا تملك صلاحية هذا الإجراء.' });
const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const route = fn => async (req, res) => { try { await fn(req, res); } catch (error) {
  const messages = { INTEGRITY: 'تعذر التحقق من سلامة الوصفة. أُوقف صرفها ويلزم مراجعة الجهة الرقابية.', UNAVAILABLE: 'الوصفة غير متاحة أو تم صرفها أو يجري التعامل معها.', STOCK: 'المخزون لا يكفي لصرف كامل الكمية.', INVALID_PRICE: 'راجع أسعار جميع الأدوية والخصم.', RECOVERY_REQUIRED: 'توقفت العملية. يلزم مراجعة حالة المخزون قبل إعادة الصرف.' };
  const message = messages[error.message];
  if (!error.status && !message) console.error('[controlled-prescriptions]', { name: error.name, code: error.code });
  res.status(error.status || (message ? 409 : error.code === 11000 ? 409 : 500)).json({ message: error.status ? error.message : message || (error.code === 11000 ? 'تم تسجيل هذا الطلب مسبقاً. حدّث الصفحة.' : 'تعذر إتمام العملية، يرجى المحاولة مرة أخرى.') });
} };
const validId = id => { if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) fail('رقم السجل غير صحيح.'); return id; };
const requestKey = value => { if (typeof value !== 'string' || !/^[\w-]{16,100}$/.test(value)) fail('معرّف الطلب غير صحيح.'); return value; };
const snapshot = user => Object.fromEntries(Object.entries({ _id: user._id, fullName: user.fullName, idNumber: user.idNumber, mobileNumber: user.mobileNumber, email: user.email, country: user.country, city: user.city, address: user.address, specialty: user.specialty }).filter(([, value]) => value !== undefined));
const contacts = 'fullName idNumber mobileNumber email country city address specialty';
const populateRx = query => query.populate('patientId', contacts).populate('doctorId', contacts).populate('dispensedBy', contacts);
async function approved(userId, role) {
  const [user, access] = await Promise.all([User.findById(userId), Access.findOne({ userId })]);
  if (!canPractice(user, access, role)) fail('الحساب غير معتمد أو موقوف عن الروشيتات الكونترولد.', 403);
  return user;
}
const pagination = req => { const page = Number(req.query.page || 1); if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail('رقم الصفحة غير صحيح.'); return { page, limit: 30 }; };
const identityFilter = async idNumber => {
  if (typeof idNumber !== 'string' || !/^[\p{L}\d-]{5,24}$/u.test(idNumber.trim())) fail('رقم الهوية غير صحيح.');
  const patient = await User.findOne({ role: 'User', idNumber: idNumber.trim() }).select('_id');
  return patient?._id || new mongoose.Types.ObjectId();
};

router.get('/context', route(async (req, res) => {
  const { id, role, user, account } = req.controlledActor;
  const access = user ? await Access.findOne({ userId: id }).lean() : null;
  let available = 0;
  if (role === 'Doctor') {
    const allocations = await Allocation.find({ doctorId: id, paid: true, ready: true }).select('_id');
    available = await Rx.countDocuments({ doctorId: id, allocationId: { $in: allocations.map(a => a._id) }, issuedAt: null });
  }
  res.json({ role, account: account ? { id: account._id, name: account.name, nameAr: account.nameAr, type: account.type } : null, palestinian: isPalestinian(user), canWrite: canPractice(user, access, 'Doctor'), canDispense: canPractice(user, access, 'Pharmacy'), access, available });
}));

router.post('/account/password', allow(...oversightRoles), require('../middleware/authRateLimiter').controlledAccountLimiter, route(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (typeof currentPassword !== 'string' || Buffer.byteLength(currentPassword, 'utf8') > 72 || typeof newPassword !== 'string'
    || newPassword.length < 12 || Buffer.byteLength(newPassword, 'utf8') > 72 || currentPassword === newPassword) fail('اختر كلمة مرور جديدة من ١٢ حرفاً على الأقل، وحتى ٧٢ بايت.');
  const account = await Oversight.findById(req.controlledActor.id);
  if (!account || !await bcrypt.compare(currentPassword, account.password)) fail('كلمة المرور الحالية غير صحيحة.', 403);
  const changed = await Oversight.updateOne({ _id: account._id, password: account.password }, { $set: { password: await bcrypt.hash(newPassword, 12), passwordChangedAt: new Date(Math.floor(Date.now() / 1000) * 1000) }, $inc: { sessionVersion: 1 } });
  if (!changed.modifiedCount) fail('تغيرت بيانات الحساب. سجل الدخول مجدداً.', 409);
  res.json({ message: 'تم تغيير كلمة المرور وإنهاء جميع جلسات الحساب.' });
}));
router.post('/account/logout', allow(...oversightRoles), route(async (req, res) => {
  await Oversight.updateOne({ _id: req.controlledActor.id }, { $inc: { sessionVersion: 1 } });
  res.json({ message: 'تم إنهاء جميع جلسات الحساب.' });
}));
router.get('/providers', allow(...oversightRoles), route(async (req, res) => {
  const { role } = req.controlledActor;
  const providerRole = req.query.role === 'Pharmacy' ? 'Pharmacy' : 'Doctor';
  if (role === 'pharmacy_syndicate' && providerRole !== 'Pharmacy') fail('هذه القائمة متاحة للوزارة ونقابة الأطباء.', 403);
  if (role === 'medical_syndicate' && providerRole !== 'Doctor') fail('هذه القائمة متاحة للوزارة ونقابة الصيادلة.', 403);
  const { page, limit } = pagination(req);
  const filter = { role: providerRole, country: { $in: palestinianCountries } };
  if (req.query.q) filter.fullName = { $regex: String(req.query.q).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const permission = req.query.permission || 'all';
  const activity = req.query.activity || 'all';
  if (!['all', 'enabled', 'not_allowed', 'ministry_blocked', 'union_blocked', 'unapproved', 'inactive'].includes(permission)
      || !['all', 'active', 'none'].includes(activity)) fail('قيمة الفلتر غير صحيحة.');
  const conditions = [];
  if (permission !== 'all') {
    const enabledFilter = { unionApproved: true, ministrySuspended: { $ne: true } };
    const blockedFilter = { unionApproved: false, 'audit.action': 'unionApproved:false' };
    if (['enabled', 'not_allowed'].includes(permission)) {
      const enabled = await Access.find(enabledFilter).select('userId');
      const enabledIds = enabled.map(row => row.userId);
      conditions.push(permission === 'enabled' ? { _id: { $in: enabledIds }, activationStatus: 'active' }
        : { $or: [{ _id: { $nin: enabledIds } }, { activationStatus: { $ne: 'active' } }] });
    } else if (permission === 'inactive') conditions.push({ activationStatus: { $ne: 'active' } });
    else if (permission === 'unapproved') {
      const assigned = await Access.find({ $or: [{ unionApproved: true }, blockedFilter] }).select('userId');
      conditions.push({ _id: { $nin: assigned.map(row => row.userId) } });
    } else {
      const matching = await Access.find(permission === 'ministry_blocked' ? { ministrySuspended: true } : blockedFilter).select('userId');
      conditions.push({ _id: { $in: matching.map(row => row.userId) } });
    }
  }
  const activityField = providerRole === 'Doctor' ? 'doctorId' : 'dispensedBy';
  const activityFilter = providerRole === 'Doctor' ? { issuedAt: { $type: 'date' } } : { dispensedAt: { $type: 'date' } };
  if (activity !== 'all') {
    const activeIds = await Rx.distinct(activityField, activityFilter);
    conditions.push({ _id: { [activity === 'active' ? '$in' : '$nin']: activeIds } });
  }
  if (conditions.length) filter.$and = conditions;
  const [users, total] = await Promise.all([User.find(filter).select(`${contacts} activationStatus`).sort({ fullName: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(), User.countDocuments(filter)]);
  const ids = users.map(u => u._id);
  const [permissions, allocations, counts] = await Promise.all([
    Access.find({ userId: { $in: ids } }).lean(),
    providerRole === 'Doctor' ? Allocation.find({ doctorId: { $in: ids }, ready: true }).lean() : [],
    Rx.aggregate([{ $match: { ...activityFilter, [activityField]: { $in: ids } } }, { $group: { _id: `$${activityField}`, used: { $sum: 1 } } }]),
  ]);
  res.json({ rows: users.map(user => {
    const batches = allocations.filter(a => String(a.doctorId) === String(user._id));
    const used = counts.find(c => String(c._id) === String(user._id))?.used || 0;
    const paidQuantity = batches.filter(a => a.paid).reduce((sum, a) => sum + a.quantity - (a.retiredSlots?.length || 0), 0);
    return { ...user, access: permissions.find(a => String(a.userId) === String(user._id)) || {}, used, activityCount: used, available: providerRole === 'Doctor' ? paidQuantity - used : 0, ...(role === 'medical_syndicate' ? { allocations: batches, unpaidAmount: batches.filter(a => !a.paid).reduce((sum, a) => sum + a.quantity * 2, 0) } : {}) };
  }), page, total, totalPages: Math.ceil(total / limit) });
}));
router.patch('/providers/:id/access', allow(...oversightRoles), route(async (req, res) => {
  const { role, id: actor } = req.controlledActor;
  const user = await User.findById(validId(req.params.id));
  if (!user || !isPalestinian(user) || !['Doctor', 'Pharmacy'].includes(user.role)) fail('الحساب غير موجود.', 404);
  const ministry = role === 'ministry_of_health';
  if (!ministry && role !== (user.role === 'Doctor' ? 'medical_syndicate' : 'pharmacy_syndicate')) fail('لا تملك هذه الصلاحية.', 403);
  const field = ministry ? 'ministrySuspended' : 'unionApproved';
  if (typeof req.body[field] !== 'boolean') fail('حدد الصلاحية المطلوبة.');
  const permission = await Access.findOneAndUpdate({ userId: user._id }, { $set: { [field]: req.body[field] }, $push: { audit: { action: `${field}:${req.body[field]}`, actor: String(actor), reason: String(req.body.reason || '').slice(0, 1000) } } }, { new: true, upsert: true, setDefaultsOnInsert: true });
  res.json({ access: permission });
}));
router.patch('/doctors/:id', allow('medical_syndicate'), route(async (req, res) => {
  const update = {};
  const unset = {};
  for (const key of ['fullName', 'mobileNumber', 'email', 'idNumber', 'city', 'address', 'specialty']) {
    if (req.body[key] !== undefined) { if (typeof req.body[key] !== 'string' || req.body[key].length > 300) fail('بيانات الطبيب غير صحيحة.'); update[key] = req.body[key].trim(); }
  }
  if (update.fullName === '' || update.mobileNumber === '') fail('اسم الطبيب ورقم الموبايل مطلوبان.');
  for (const key of ['email', 'idNumber']) if (update[key] === '') { delete update[key]; unset[key] = 1; }
  const user = await User.findOneAndUpdate({ _id: validId(req.params.id), role: 'Doctor', country: { $in: palestinianCountries } }, { $set: update, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, { new: true, runValidators: true }).select(contacts);
  if (!user) fail('الطبيب غير موجود.', 404);
  await Access.findOneAndUpdate({ userId: user._id }, { $push: { audit: { action: 'profile_updated', actor: String(req.controlledActor.id), reason: Object.keys(update).join(', ') } } }, { upsert: true });
  res.json({ user });
}));
router.post('/allocations', allow('medical_syndicate'), route(async (req, res) => {
  const doctorId = validId(req.body.doctorId);
  const quantity = Number(req.body.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000 || typeof req.body.paid !== 'boolean') fail('حدد العدد من ١ إلى ١٠٠٠ وحالة الدفع.');
  const doctor = await User.findOne({ _id: doctorId, role: 'Doctor', country: { $in: palestinianCountries } });
  if (!doctor) fail('الطبيب غير موجود.', 404);
  const key = requestKey(req.body.requestId);
  const allocation = await Allocation.findOneAndUpdate({ requestId: key }, { $setOnInsert: { doctorId, quantity, paid: req.body.paid, paidAt: req.body.paid ? new Date() : null, createdBy: req.controlledActor.id, audit: [{ action: req.body.paid ? 'created_paid' : 'created_unpaid', actor: String(req.controlledActor.id) }] } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (String(allocation.doctorId) !== String(doctorId) || allocation.quantity !== quantity) fail('معرّف الطلب مستخدم لعملية أخرى.', 409);
  if (!allocation.ready) {
    await Rx.init(); // Unique indexes must exist before serials become usable.
    const tickets = Array.from({ length: allocation.quantity }, (_, index) => index).filter(index => !allocation.retiredSlots?.includes(index)).map(index => {
      const serial = serialFor(allocation._id, index);
      return { updateOne: { filter: { serial }, update: { $setOnInsert: { serial, prescriptionNumber: serial, allocationId: allocation._id, doctorId, isValid: false, workflowStatus: 'sent_to_pharmacy', products: [] } }, upsert: true } };
    });
    if (tickets.length) await Rx.bulkWrite(tickets);
    allocation.ready = true; await allocation.save();
  }
  res.json({ allocation });
}));
router.patch('/allocations/:id/payment', allow('medical_syndicate'), route(async (req, res) => {
  if (req.body.paid !== true) fail('يمكن تأكيد الدفعة فقط؛ الدفعات المؤكدة محفوظة ولا تُلغى بعد إتاحة الرصيد.');
  const allocation = await Allocation.findOneAndUpdate({ _id: validId(req.params.id), ready: true, paid: false }, { $set: { paid: true, paidAt: new Date() }, $push: { audit: { action: 'paid', actor: String(req.controlledActor.id) } } }, { new: true });
  if (!allocation) fail('الدفعة مؤكدة مسبقاً أو غير موجودة.', 409);
  res.json({ allocation });
}));
router.get('/financials', allow('medical_syndicate'), route(async (req, res) => {
  const rows = await Allocation.aggregate([{ $match: { ready: true } }, { $group: { _id: '$paid', quantity: { $sum: '$quantity' }, amount: { $sum: { $multiply: ['$quantity', '$unitPrice'] } }, syndicateShare: { $sum: { $multiply: ['$quantity', '$syndicateShare'] } }, vitaShare: { $sum: { $multiply: ['$quantity', '$vitaShare'] } } } }]);
  res.json({ paid: rows.find(r => r._id === true) || {}, unpaid: rows.find(r => r._id === false) || {} });
}));
router.get('/drugs', route(async (req, res) => {
  const role = req.controlledActor.role;
  if (![...oversightRoles, 'Doctor', 'Pharmacy'].includes(role)) fail('لا تملك هذه الصلاحية.', 403);
  const { page, limit } = pagination(req);
  const filter = { isActive: true };
  if (role !== 'ministry_of_health' || req.query.all !== 'true') {
    const approvedDrugs = await Catalogue.find({ approved: true }).select('drugId');
    filter._id = { $in: approvedDrugs.map(d => d.drugId) };
  }
  if (req.query.q) filter.name = { $regex: String(req.query.q).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const [drugs, total] = await Promise.all([Drug.find(filter).select('name genericName strength dosageForm').sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(), Drug.countDocuments(filter)]);
  const records = await Catalogue.find({ drugId: { $in: drugs.map(d => d._id) } }).lean();
  res.json({ rows: drugs.map(drug => ({ ...drug, approved: records.find(r => String(r.drugId) === String(drug._id))?.approved === true })), page, total, totalPages: Math.ceil(total / limit) });
}));
router.patch('/drugs/:id', allow('ministry_of_health'), route(async (req, res) => {
  if (typeof req.body.approved !== 'boolean') fail('حدد حالة اعتماد الدواء.');
  const drug = await Drug.findById(validId(req.params.id)).select('_id');
  if (!drug) fail('الدواء غير موجود.', 404);
  const record = await Catalogue.findOneAndUpdate({ drugId: drug._id }, { $set: { approved: req.body.approved }, $push: { audit: { action: req.body.approved ? 'approved' : 'removed', actor: String(req.controlledActor.id) } } }, { new: true, upsert: true, setDefaultsOnInsert: true });
  res.json({ record });
}));
router.get('/inventory', allow('ministry_of_health'), route(async (req, res) => {
  const { page, limit } = pagination(req);
  const catalogue = await Catalogue.find({ approved: true }).select('drugId');
  const pharmacies = await User.find({ role: 'Pharmacy', country: { $in: palestinianCountries } }).select('_id');
  const stockFilter = { pharmacyId: { $in: pharmacies.map(p => p._id) }, isActive: true };
  const drugFilter = { _id: { $in: catalogue.map(d => d.drugId) } };
  if (req.query.drugId) {
    const drugId = validId(req.query.drugId);
    if (!catalogue.some(d => String(d.drugId) === String(drugId))) fail('الدواء غير معتمد ككونترول.', 404);
    const drug = await Drug.findById(drugId).select('name genericName strength dosageForm').lean();
    if (!drug) fail('الدواء غير موجود.', 404);
    const filter = { ...stockFilter, drugId: new mongoose.Types.ObjectId(drugId) };
    const [rows, total, totals] = await Promise.all([
      Inventory.find(filter).select('pharmacyId quantity isAvailable').populate('pharmacyId', contacts)
        .sort({ quantity: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Inventory.countDocuments(filter), Inventory.aggregate([{ $match: filter }, { $group: { _id: null, quantity: { $sum: '$quantity' } } }]),
    ]);
    return res.json({ drug, quantity: totals[0]?.quantity || 0, rows, total, page, totalPages: Math.ceil(total / limit) });
  }
  if (req.query.q) drugFilter.name = { $regex: String(req.query.q).slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const [drugs, total] = await Promise.all([
    Drug.find(drugFilter).select('name genericName strength dosageForm').sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Drug.countDocuments(drugFilter),
  ]);
  const totals = await Inventory.aggregate([{ $match: { ...stockFilter, drugId: { $in: drugs.map(d => d._id) } } },
    { $group: { _id: '$drugId', quantity: { $sum: '$quantity' }, pharmacies: { $sum: 1 } } },
  ]);
  res.json({ rows: drugs.map(drug => { const stock = totals.find(row => String(row._id) === String(drug._id)); return { ...drug, quantity: stock?.quantity || 0, pharmacies: stock?.pharmacies || 0 }; }), total, page, totalPages: Math.ceil(total / limit) });
}));
router.post('/prescriptions', allow('Doctor'), route(async (req, res) => {
  const doctor = await approved(req.controlledActor.id, 'Doctor');
  const key = requestKey(req.body.requestId);
  const existing = await Rx.findOne({ doctorId: doctor._id, issueRequestId: key });
  if (existing) return res.json({ prescription: existing });
  const patient = await User.findOne({ _id: validId(req.body.patientId), role: 'User' });
  if (!patient || !patient.idNumber || !patient.mobileNumber) fail('المريض يجب أن يكون مسجلاً برقم الهوية والموبايل.');
  try { validateControlledProducts(req.body.products); } catch (error) { fail(error.message); }
  if (!['one-time', 'time-limited'].includes(req.body.validityType)) fail('حدد صلاحية الوصفة.');
  const expiryDate = req.body.validityType === 'time-limited' ? new Date(req.body.expiryDate) : null;
  if (expiryDate && (!Number.isFinite(expiryDate.getTime()) || expiryDate <= new Date())) fail('تاريخ انتهاء الوصفة يجب أن يكون في المستقبل.');
  const ids = req.body.products.map(p => p.drugId);
  const [catalogue, drugs] = await Promise.all([Catalogue.find({ drugId: { $in: ids }, approved: true }), Drug.find({ _id: { $in: ids }, isActive: true })]);
  if (catalogue.length !== ids.length || drugs.length !== ids.length) fail('يوجد دواء غير معتمد من الوزارة.');
  const allocations = await Allocation.find({ doctorId: doctor._id, paid: true, ready: true }).select('_id');
  await Rx.init();
  const clinical = {
    patientId: patient._id, patientSnapshot: snapshot(patient), doctorSnapshot: snapshot(doctor), issuedAt: new Date(), date: new Date(), issueRequestId: key, isValid: true,
    validityType: req.body.validityType, expiryDate, diagnosis: String(req.body.diagnosis || '').slice(0, 2000), notes: String(req.body.notes || '').slice(0, 4000),
    products: req.body.products.map(p => ({ _id: new mongoose.Types.ObjectId(), drugId: p.drugId, name: drugs.find(d => String(d._id) === String(p.drugId)).name, quantity: Number(p.quantity), allowedPills: Number(p.allowedPills), dose: String(p.dose).trim().slice(0, 500), frequency: String(p.frequency).trim().slice(0, 500), instructions: String(p.instructions || '').slice(0, 2000) })),
  };
  let prescription;
  for (let attempt = 0; attempt < 10 && !prescription; attempt++) {
    const ticket = await Rx.findOne({ doctorId: doctor._id, issuedAt: null, allocationId: { $in: allocations.map(a => a._id) } }).sort({ serial: 1 }).lean();
    if (!ticket) break;
    await approved(doctor._id, 'Doctor');
    const integritySeal = signPrescription({ ...ticket, ...clinical });
    try {
      prescription = await Rx.findOneAndUpdate({ _id: ticket._id, issuedAt: null }, { $set: { ...clinical, integrityVersion: 1, integritySeal },
        $push: { audit: { action: 'issued', actor: String(doctor._id) } } }, { new: true, runValidators: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
      prescription = await Rx.findOne({ doctorId: doctor._id, issueRequestId: key });
      if (!prescription) throw error;
    }
  }
  if (!prescription) fail('لا يوجد رصيد روشيتات مدفوع متاح.', 409);
  res.status(201).json({ prescription });
}));
router.get('/prescriptions', route(async (req, res) => {
  const { role, id } = req.controlledActor;
  const { page, limit } = pagination(req);
  const filter = { issuedAt: { $type: 'date' } };
  if (role === 'Doctor') { filter.doctorId = id; if (req.query.patientId) filter.patientId = validId(req.query.patientId); }
  else if (role === 'Pharmacy') {
    if (req.query.history === 'true') { filter.dispensedBy = id; filter.dispensedAt = { $type: 'date' }; }
    else {
      const user = await User.findById(id); const access = await Access.findOne({ userId: id });
      if (!canPractice(user, access, 'Pharmacy')) return res.json({ rows: [], page, total: 0, totalPages: 0 });
      if (!req.query.idNumber) fail('أدخل رقم هوية المريض.');
      Object.assign(filter, activePrescriptionFilter(), { patientId: await identityFilter(req.query.idNumber) });
    }
  } else if (!oversightRoles.includes(role)) fail('لا تملك هذه الصلاحية.', 403);
  if (req.query.doctorId && oversightRoles.includes(role)) filter.doctorId = validId(req.query.doctorId);
  if (req.query.serial) filter.serial = String(req.query.serial).trim().toUpperCase();
  for (const [key, op] of [['from', '$gte'], ['to', '$lte']]) if (req.query[key]) {
    const value = new Date(req.query[key]); if (!Number.isFinite(value.getTime())) fail('التاريخ غير صحيح.');
    filter.issuedAt[op] = value;
  }
  const [rows, total] = await Promise.all([populateRx(Rx.find(filter).select('+integritySeal')).sort({ issuedAt: req.query.sort === 'oldest' ? 1 : -1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(), Rx.countDocuments(filter)]);
  const quotes = role === 'Pharmacy' ? await Quote.find({ pharmacy: id, prescription: { $in: rows.map(r => r._id) } }).lean() : [];
  const inventory = role === 'Pharmacy' ? await Inventory.find({ pharmacyId: id, isActive: true, drugId: { $in: rows.flatMap(r => r.products.map(p => p.drugId)) } }).lean() : [];
  res.json({ rows: rows.map(row => ({ ...row, integrityValid: verifyPrescription(row), integritySeal: undefined, pharmacyQuote: quotes.find(q => String(q.prescription) === String(row._id)) || null, products: row.products.map(p => ({ ...p, inventory: inventory.find(i => String(i.drugId) === String(p.drugId)) || null })) })), page, total, totalPages: Math.ceil(total / limit) });
}));
router.get('/prescriptions/:id', allow(...oversightRoles, 'Doctor', 'Pharmacy'), route(async (req, res) => {
  const { role, id } = req.controlledActor;
  const prescription = await populateRx(Rx.findOne({ _id: validId(req.params.id), issuedAt: { $type: 'date' } }).select('+integritySeal')).lean();
  if (!prescription) fail('الوصفة غير موجودة.', 404);
  if (role === 'Doctor' && String(prescription.doctorId?._id) !== String(id)) fail('لا تملك صلاحية الاطلاع.', 403);
  if (role === 'Pharmacy' && String(prescription.dispensedBy?._id) !== String(id)) fail('استخدم البحث برقم الهوية للوصفات غير المصروفة.', 403);
  const quote = role === 'ministry_of_health' ? null : await Quote.findOne({ prescription: prescription._id, status: 'dispensed' }).lean();
  res.json({ prescription: { ...prescription, integrityValid: verifyPrescription(prescription), integritySeal: undefined, pharmacyQuote: quote } });
}));
// Competes atomically with dispensing's final isValid check. Keep any stock
// reservation lock so an in-flight dispense can safely compensate its writes.
router.patch('/prescriptions/:id/stop', allow(...oversightRoles), route(async (req, res) => {
  const { id, role, account } = req.controlledActor;
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason || reason.length > 1000) fail('أدخل سبب الإيقاف، حتى ١٠٠٠ حرف.');
  const at = new Date();
  const prescription = await Rx.findOneAndUpdate({
    _id: validId(req.params.id), issuedAt: { $type: 'date' }, dispensedAt: null,
    dispensedCount: { $in: [0, null] }, stoppedAt: null,
  }, { $set: { isValid: false, stoppedAt: at, stoppedBy: id, stoppedByRole: role,
    stoppedByName: account?.nameAr || account?.name || role, stopReason: reason },
    $push: { audit: { action: 'stopped', actor: String(id), at, details: reason } },
  }, { new: true, runValidators: true });
  if (!prescription) fail('لا يمكن إيقاف الوصفة: تم صرفها أو إيقافها مسبقاً، أو أنها غير موجودة.', 409);
  res.json({ prescription });
}));
router.put('/prescriptions/:id/:action', allow('Pharmacy'), route(async (req, res) => {
  if (!['quote', 'dispense'].includes(req.params.action)) fail('الإجراء غير صحيح.');
  const pharmacy = await approved(req.controlledActor.id, 'Pharmacy');
  const prescription = await Rx.findOne({ _id: validId(req.params.id), issuedAt: { $type: 'date' }, ...activePrescriptionFilter() });
  if (!prescription) fail('الوصفة غير متاحة.', 409);
  const checkPermissions = async () => {
    await approved(pharmacy._id, 'Pharmacy');
    await approved(prescription.doctorId, 'Doctor');
    const approvedDrugs = await Catalogue.countDocuments({ drugId: { $in: prescription.products.map(p => p.drugId) }, approved: true });
    if (approvedDrugs !== prescription.products.length) fail('دواء في هذه الوصفة أُوقف من قائمة الوزارة.', 403);
  };
  await checkPermissions();
  const dispense = req.params.action === 'dispense';
  const quote = await saveStandalonePrescription({ Prescription: Rx, Inventory, Quote,
    prescriptionId: prescription._id, pharmacyId: pharmacy._id, items: req.body.items, dispense,
    validatePrescription: async locked => requireIntegrity(await Rx.findById(locked._id).select('+integritySeal')),
    beforeCommit: async () => { await checkPermissions(); requireIntegrity(await Rx.findById(prescription._id).select('+integritySeal')); },
    commitFields: dispense ? { pharmacySnapshot: snapshot(pharmacy) } : {},
    auditEvent: { action: dispense ? 'dispensed' : 'priced', actor: String(pharmacy._id), at: new Date() },
  });
  res.json({ quote, dispensed: dispense });
}));
router.post('/accounts', allow('Admin', 'Superadmin'), route(async (req, res) => {
  const { type, name, nameAr, email, phone, username, password } = req.body;
  if (!oversightRoles.includes(type) || [name, nameAr, email, phone, username, password].some(v => typeof v !== 'string' || !v.trim()) || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72 || [name, nameAr, email, phone, username].some(v => v.length > 200)) fail('أدخل بيانات الحساب وكلمة مرور من ١٢ حرفاً على الأقل.');
  if (await Oversight.exists({ type })) fail('حساب هذه الجهة موجود مسبقاً.', 409);
  const account = await Oversight.create({ type, name: name.trim(), nameAr: nameAr.trim(), email: email.trim(), phone: phone.trim(), username: username.trim(), password: await bcrypt.hash(password, 12) });
  res.status(201).json({ account: { id: account._id, type: account.type, username: account.username } });
}));
module.exports = router;
