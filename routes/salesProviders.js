// Mounted after sales authentication: both sales representatives and team leads.
const router = require('express').Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const MedicalTest = require('../models/MedicalTest');
const LaboratoryService = require('../models/LaboratoryService');
const { validatePasswordPolicy } = require('../utils/passwordPolicy');
const { normalizeMobileForStorage, getMobileCandidates } = require('../utils/mobileNumber');
const providerFilter = role => ({ role, activationStatus: 'active', isPublic: { $ne: false }, clinicId: null, internalDepartment: { $in: ['', null] } });
const configuration = role => role === 'Lab' ? { Model: LaboratoryService, owner: 'laboratoryId', fields: 'name price category normalRange unit fields' }
  : role === 'Radiology' ? { Model: MedicalTest, owner: 'providerId', fields: 'name price category description preparationInstructions estimatedDuration', type: 'radiology' } : null;
const serviceFilter = (config, id) => ({ [config.owner]: id, isActive: true, price: { $gte: 0 }, ...(config.type ? { type: config.type } : {}) });
router.get('/templates', async (req, res) => {
  const config = configuration(req.query.role);
  if (!config) return res.status(400).json({ message: 'اختاري مختبرًا أو مركز أشعة.' });
  try {
    const providers = await User.find(providerFilter(req.query.role)).select('_id fullName').sort({ fullName: 1 }).lean();
    const templates = await Promise.all(providers.map(async provider => ({ _id: provider._id, fullName: provider.fullName,
      services: await config.Model.find(serviceFilter(config, provider._id)).select(config.fields).sort({ name: 1 }).lean() })));
    res.json({ templates: templates.filter(template => template.services.length).sort((a, b) => b.services.length - a.services.length || String(a._id).localeCompare(String(b._id))) });
  } catch { res.status(500).json({ message: 'تعذر تحميل قوائم الخدمات.' }); }
});
router.post('/', require('../middleware/authRateLimiter').salesSignupLimiter, async (req, res) => {
  let ownerId, config;
  try {
    const { role, fullName, mobile, password, city, address, sourceId, licenseNumber } = req.body || {};
    config = configuration(role);
    if (!config || [fullName, mobile, city, address].some(v => typeof v !== 'string' || !v.trim() || v.length > 200) || (licenseNumber != null && (typeof licenseNumber !== 'string' || licenseNumber.length > 100))) return res.status(400).json({ message: 'أدخلي الاسم والجوال والمدينة والعنوان بشكل صحيح.' });
    if (validatePasswordPolicy(password, fullName)) return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل ولا تحتوي على اسم الحساب.' });
    const mobileNumber = normalizeMobileForStorage(mobile);
    if (!/^05[69]\d{7}$/.test(mobileNumber)) return res.status(400).json({ message: 'أدخلي رقم جوال فلسطيني صحيح.' });
    if (typeof sourceId !== 'string' || !/^[a-f\d]{24}$/i.test(sourceId) || !await User.exists({ ...providerFilter(role), _id: sourceId })) return res.status(400).json({ message: 'اختاري قائمة خدمات متاحة من نفس نوع الحساب.' });
    const candidates = getMobileCandidates(mobile);
    if (await User.exists({ mobileNumber: { $in: [...candidates, ...candidates.map(value => '+' + value)] } })) return res.status(409).json({ message: 'رقم الجوال مستخدم مسبقًا.' });
    const services = await config.Model.find(serviceFilter(config, sourceId)).select(config.fields).sort({ name: 1 }).lean();
    if (!services.length) return res.status(409).json({ message: 'القائمة المرجعية فارغة. اختاري قائمة أخرى.' });
    const hashed = await bcrypt.hash(password, 12);
    ownerId = new mongoose.Types.ObjectId();
    // Publish the account only after all its services are ready; compensate partial inserts on failure.
    const copied = services.map(service => {
      const copy = Object.fromEntries(config.fields.split(' ').filter(key => service[key] !== undefined).map(key => [key, service[key]]));
      return { ...copy, [config.owner]: ownerId, isActive: true, ...(config.type ? { type: config.type, createdBy: req.user._id } : {}) };
    });
    await config.Model.insertMany(copied, { ordered: true });
    const user = await User.create({ _id: ownerId, fullName: fullName.trim(), mobileNumber, password: hashed, role, city: city.trim(), address: address.trim(),
      country: 'Palestine', language: 'ar', licenseNumber: licenseNumber?.trim() || undefined,
      activationStatus: 'active', isPhoneVerified: true, isPublic: true, internalDepartment: '',
      salesManager: req.user._id, registeredBy: req.user._id, approvedBy: req.user._id, approvedAt: new Date() });
    res.status(201).json({ user: { _id: user._id, fullName: user.fullName, role: user.role, activationStatus: user.activationStatus }, serviceCount: copied.length });
  } catch (error) {
    if (ownerId) {
      try { await config.Model.deleteMany({ [config.owner]: ownerId }); await User.deleteOne({ _id: ownerId, registeredBy: req.user._id }); }
      catch { return res.status(503).json({ message: 'تعذر إكمال الإعداد. يرجى مراجعة الدعم قبل إعادة المحاولة.' }); }
    }
    res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'بيانات الحساب مستخدمة مسبقًا.' : 'تعذر إنشاء الحساب وقائمة خدماته.' });
  }
});
module.exports = router;
