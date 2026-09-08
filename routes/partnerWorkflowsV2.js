const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const MedicalTest = require('../models/MedicalTest');
const LabRequest = require('../models/LabRequest');
const Prescription = require('../models/EPrescription');
const Drug = require('../models/Drug');
const MedicalRecord = require('../models/MedicalRecord');
const LegacyRecord = require('../models/Record');
const Financial = require('../models/Financial');
const PharmacyPrescriptionQuote = require('../models/PharmacyPrescriptionQuote');
const { getMobileCandidates, normalizeMobileForStorage } = require('../utils/mobileNumber');
const { sendWhatsAppMessage, isWhatsAppReady } = require('../services/whatsappService');

const router = express.Router();
router.use(auth);

const resultUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => callback(null, 'uploads/lab-results/'),
    filename: (req, file, callback) => callback(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  fileFilter: (req, file, callback) => callback(null, ['application/pdf', 'image/jpeg', 'image/png', 'application/dicom', 'application/octet-stream'].includes(file.mimetype)),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
});

const normalize = (value = '') => String(value).trim().toLowerCase()
  .normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g, '').replace(/أ|إ|آ/g, 'ا');
const isDentist = (user) => ['dentist', 'dental', 'dentistry', 'اسنان'].some((term) => normalize(user?.specialty).includes(term));
const isNablus = (user) => ['nablus', 'نابلس'].some((term) => normalize(user?.city).includes(term));
const isBurj = (user) => ['البرج', 'al burj', 'albourj', 'burj'].some((term) => normalize(user?.fullName).includes(term));
const idIsValid = (id) => /^[\p{L}\d-]{5,24}$/u.test(String(id || '').trim());
const objectIdIsValid = (id) => mongoose.Types.ObjectId.isValid(id);
const isSelectedPharmacy = (user) => user?.role === 'Pharmacy' && user?.activationStatus === 'active' && user?.patientOrderingEnabled !== false;

const requireDentist = (req, res, next) => {
  if (req.user.role !== 'Doctor' || !isDentist(req.user) || !isNablus(req.user)) {
    return res.status(403).json({ message: 'This workflow is available to dentists in Nablus only.' });
  }
  next();
};
const requireBurj = (req, res, next) => {
  if (req.user.role !== 'Radiology' || !isBurj(req.user)) {
    return res.status(403).json({ message: 'This workflow is available to Al Burj Radiology Center only.' });
  }
  next();
};
const requireSelectedPharmacy = (req, res, next) => {
  if (!isSelectedPharmacy(req.user)) return res.status(403).json({ message: 'This pharmacy is not enabled by the administrator.' });
  next();
};

const publicPatient = (patient) => ({
  _id: patient._id, fullName: patient.fullName, idNumber: patient.idNumber,
  mobileNumber: patient.mobileNumber, birthdate: patient.birthdate, sex: patient.sex,
});

const findBurjCenters = () => User.find({
  role: 'Radiology', activationStatus: 'active',
  $or: [{ fullName: /البرج/i }, { fullName: /al\s*burj/i }, { fullName: /albourj/i }],
}).select('fullName city address mobileNumber').sort({ fullName: 1 }).lean();

router.get('/context', async (req, res) => {
  try {
    const dentist = req.user.role === 'Doctor' && isDentist(req.user) && isNablus(req.user);
    const burj = req.user.role === 'Radiology' && isBurj(req.user);
    const pharmacy = isSelectedPharmacy(req.user);
    const response = { capabilities: { dentist, burj, pharmacy } };
    if (dentist) {
      const centers = await findBurjCenters();
      const center = centers[0] || null;
      response.radiologyCenter = center;
      response.radiologyCenters = centers;
      response.radiologyServices = centers.length ? await MedicalTest.find({ providerId: { $in: centers.map((item) => item._id) }, type: 'radiology', isActive: true })
        .select('name category description providerId').sort({ category: 1, name: 1 }).lean() : [];
      response.stats = {
        prescriptions: await Prescription.countDocuments({ doctorId: req.user._id, distributionChannel: 'vita_partner_network' }),
        radiologyRequests: await LabRequest.countDocuments({ doctorId: req.user._id, labId: { $in: centers.map((item) => item._id) } }),
        reports: await MedicalRecord.countDocuments({ doctor: req.user._id }),
      };
    } else if (burj) {
      response.stats = {
        pending: await LabRequest.countDocuments({ labId: req.user._id, status: 'pending' }),
        inProgress: await LabRequest.countDocuments({ labId: req.user._id, status: { $in: ['in_progress', 'in-progress'] } }),
        completed: await LabRequest.countDocuments({ labId: req.user._id, status: 'completed' }),
      };
    } else if (pharmacy) {
      response.stats = {
        incoming: await Prescription.countDocuments({ distributionChannel: 'vita_partner_network', isValid: true, dispensedAt: null }),
        priced: await PharmacyPrescriptionQuote.countDocuments({ pharmacy: req.user._id, status: 'priced' }),
      };
    }
    res.json(response);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load partner workflow.' });
  }
});

router.get('/patients/by-id/:idNumber', async (req, res) => {
  try {
    const allowed = (req.user.role === 'Doctor' && isDentist(req.user) && isNablus(req.user)) || isSelectedPharmacy(req.user) || (req.user.role === 'Radiology' && isBurj(req.user));
    if (!allowed) return res.status(403).json({ message: 'Not allowed.' });
    if (!idIsValid(req.params.idNumber)) return res.status(400).json({ message: 'Invalid ID number.' });
    const patient = await User.findOne({ role: 'User', idNumber: String(req.params.idNumber).trim() })
      .select('fullName idNumber mobileNumber birthdate sex').lean();
    if (!patient) return res.status(404).json({ message: 'Patient not found.' });
    res.json({ patient: publicPatient(patient) });
  } catch (error) { res.status(500).json({ message: 'Failed to find patient.' }); }
});

router.get('/dentist/patients', requireDentist, async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().slice(0, 80);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 50);
    const patientIds = Array.isArray(req.user.patients) ? req.user.patients : [];
    const filter = { role: 'User', _id: { $in: patientIds } };
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { fullName: { $regex: escaped, $options: 'i' } },
        { idNumber: { $regex: escaped, $options: 'i' } },
        { mobileNumber: { $regex: escaped, $options: 'i' } },
      ];
    }
    const [patients, total] = await Promise.all([
      User.find(filter).select('fullName idNumber mobileNumber birthdate sex').sort({ fullName: 1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    res.json({ patients: patients.map(publicPatient), total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) { res.status(500).json({ message: 'Failed to load doctor patients.' }); }
});

router.post('/dentist/patients', requireDentist, async (req, res) => {
  let createdPatient = null;
  try {
    const fullName = String(req.body.fullName || '').trim().slice(0, 120);
    const mobileNumber = normalizeMobileForStorage(req.body.mobileNumber);
    const idNumber = String(req.body.idNumber || '').trim();
    const address = String(req.body.address || '').trim().slice(0, 300);
    if (!fullName || !mobileNumber || !idIsValid(idNumber)) {
      return res.status(400).json({ message: 'Name, mobile number, and a valid ID number are required.' });
    }
    const duplicate = await User.findOne({
      $or: [{ mobileNumber: { $in: getMobileCandidates(req.body.mobileNumber) } }, { idNumber }],
    }).select('mobileNumber idNumber');
    if (duplicate) {
      const field = duplicate.idNumber === idNumber ? 'idNumber' : 'mobileNumber';
      return res.status(409).json({ field, message: field === 'idNumber' ? 'ID number already exists.' : 'Mobile number already exists.' });
    }
    const temporaryPassword = `Vita-${crypto.randomBytes(6).toString('base64url')}`;
    createdPatient = await User.create({
      fullName, mobileNumber, idNumber, address: address || req.user.address || 'Not provided',
      country: req.user.country || 'Palestine', city: req.user.city || 'Nablus', role: 'User',
      password: await bcrypt.hash(temporaryPassword, 12), activationStatus: 'active',
      isPhoneVerified: false, profileCompletionPromptDismissed: false,
    });
    await User.updateOne({ _id: req.user._id }, { $addToSet: { patients: createdPatient._id } });
    res.status(201).json({ patient: publicPatient(createdPatient), temporaryPassword });
  } catch (error) {
    if (createdPatient?._id) await User.deleteOne({ _id: createdPatient._id }).catch(() => {});
    if (error?.code === 11000) return res.status(409).json({ message: 'Mobile number or ID number already exists.' });
    res.status(500).json({ message: 'Failed to create patient account.' });
  }
});

router.get('/dentist/patients/:patientId/billing', requireDentist, async (req, res) => {
  try {
    if (!objectIdIsValid(req.params.patientId)) return res.status(400).json({ message: 'Invalid patient.' });
    const isLinked = (req.user.patients || []).some((id) => String(id) === String(req.params.patientId));
    if (!isLinked) return res.status(403).json({ message: 'This patient is not linked to your account.' });
    const patient = await User.findOne({ _id: req.params.patientId, role: 'User' }).select('fullName idNumber mobileNumber').lean();
    if (!patient) return res.status(404).json({ message: 'Patient not found.' });
    const financial = await Financial.findOne({ doctorId: req.user._id }).lean();
    const transactions = (financial?.transactions || []).filter((item) => String(item.patientId || '') === String(patient._id))
      .map((item) => ({ _id: item._id, type: 'payment', amount: Number(item.amount) || 0, description: item.description, date: item.date, paymentMethod: item.paymentMethod, medicalRecordId: item.medicalRecordId }));
    const debts = (financial?.debts || []).filter((item) => item.debtorType !== 'insurance' && String(item.patientId || '') === String(patient._id))
      .map((item) => ({ _id: item._id, type: 'debt', amount: Number(item.amount) || 0, originalAmount: Number(item.originalAmount) || Number(item.amount) || 0, description: item.description, date: item.date, status: item.status, paidAt: item.paidAt, medicalRecordId: item.medicalRecordId }));
    const history = [...transactions, ...debts].sort((a, b) => new Date(b.date || b.paidAt) - new Date(a.date || a.paidAt));
    const totalPaid = transactions.reduce((sum, item) => sum + item.amount, 0);
    const totalOutstanding = debts.filter((item) => item.status === 'pending').reduce((sum, item) => sum + item.amount, 0);
    const totalDebtCreated = debts.reduce((sum, item) => sum + item.originalAmount, 0);
    res.json({ patient: publicPatient(patient), summary: { totalPaid, totalOutstanding, totalDebtCreated }, history });
  } catch (error) { res.status(500).json({ message: 'Failed to load patient billing history.' }); }
});

router.get('/dentist/patients/:patientId/history', requireDentist, async (req, res) => {
  try {
    if (!objectIdIsValid(req.params.patientId)) return res.status(400).json({ message: 'Invalid patient.' });
    const patientId = String(req.params.patientId);
    const isLinked = (req.user.patients || []).some((id) => String(id) === patientId);
    if (!isLinked) return res.status(403).json({ message: 'This patient is not linked to your account.' });
    const patient = await User.findOne({ _id: patientId, role: 'User' }).select('fullName idNumber mobileNumber').lean();
    if (!patient) return res.status(404).json({ message: 'Patient not found.' });
    const radiologyTestIds = await MedicalTest.find({ type: 'radiology' }).distinct('_id');
    const [reports, legacyReports, radiologyRequests, prescriptions] = await Promise.all([
      MedicalRecord.find({ patient: patientId, doctor: req.user._id })
        .select('doctor date title chiefComplaint diagnosis treatment recommendations notes selectedTeeth treatmentCost billing createdAt')
        .sort({ date: -1 }).limit(100).lean(),
      LegacyRecord.find({ patientId, doctorId: req.user._id })
        .select('doctorId patientId appointmentDate issueDescription treatmentPlan ePrescription createdAt')
        .sort({ createdAt: -1 }).limit(100).lean(),
      LabRequest.find({ patientId, doctorId: req.user._id, testIds: { $in: radiologyTestIds } })
        .select('doctorId labId testIds status requestDate completedDate notes results originalCost discount discountAmount totalCost vitaCommissionPercent vitaCommissionAmount providerNetAmount createdAt')
        .populate('labId', 'fullName city address mobileNumber').populate('testIds', 'name category type price')
        .sort({ createdAt: -1 }).limit(100).lean(),
      Prescription.find({ patientId, doctorId: req.user._id })
        .select('products diagnosis notes date expiryDate prescriptionNumber isValid dispensedAt dispensedBy distributionChannel createdAt')
        .populate('products.drugId', 'name genericName strength dosageForm').populate('dispensedBy', 'fullName')
        .sort({ date: -1 }).limit(100).lean(),
    ]);
    const doctorId = String(req.user._id);
    const normalizedLegacyReports = legacyReports
      .filter((record) => String(record.doctorId) === doctorId)
      .map((record) => ({
        _id: record._id,
        doctor: record.doctorId,
        date: record.appointmentDate || record.createdAt,
        title: 'Dental report',
        diagnosis: record.issueDescription || '',
        treatment: record.treatmentPlan || '',
        notes: record.ePrescription || '',
        selectedTeeth: [],
        source: 'legacy',
        createdAt: record.createdAt,
      }));
    const ownedReports = [
      ...reports.filter((record) => String(record.doctor) === doctorId),
      ...normalizedLegacyReports,
    ].sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
    res.json({
      patient: publicPatient(patient),
      reports: ownedReports,
      radiologyRequests: radiologyRequests.filter((request) => String(request.doctorId) === doctorId),
      prescriptions,
    });
  } catch (error) { res.status(500).json({ message: 'Failed to load patient clinical history.' }); }
});

router.post('/dentist/prescriptions', requireDentist, async (req, res) => {
  try {
    const { patientId, products, diagnosis = '', notes = '' } = req.body;
    if (!objectIdIsValid(patientId) || !Array.isArray(products) || !products.length || products.length > 30) {
      return res.status(400).json({ message: 'Patient and at least one medicine are required.' });
    }
    const patient = await User.findOne({ _id: patientId, role: 'User' }).select('_id');
    if (!patient) return res.status(404).json({ message: 'Patient not found.' });
    if (products.some((item) => !objectIdIsValid(item.drugId))) return res.status(400).json({ message: 'Select every medicine from the drug database.' });
    const drugs = await Drug.find({ _id: { $in: products.map((item) => item.drugId) }, isActive: true }).select('name').lean();
    const drugsById = new Map(drugs.map((drug) => [String(drug._id), drug]));
    if (drugsById.size !== new Set(products.map((item) => String(item.drugId))).size) return res.status(400).json({ message: 'One or more selected medicines are unavailable.' });
    const cleanedProducts = products.map((item) => ({
      name: drugsById.get(String(item.drugId)).name,
      dose: String(item.dose || '').trim().slice(0, 120),
      quantity: Math.min(Math.max(Number(item.quantity) || 1, 1), 999),
      instructions: String(item.instructions || '').trim().slice(0, 500),
      drugId: item.drugId,
    }));
    if (cleanedProducts.some((item) => !item.name || !item.dose)) return res.status(400).json({ message: 'Medicine name and dose are required.' });
    const prescription = await Prescription.create({
      patientId, doctorId: req.user._id, products: cleanedProducts,
      diagnosis: String(diagnosis).trim().slice(0, 500), notes: String(notes).trim().slice(0, 1000),
      distributionChannel: 'vita_partner_network', workflowStatus: 'sent_to_pharmacy',
      expiryDate: new Date(Date.now() + 30 * 86400000), validityType: 'one-time',
    });
    res.status(201).json({ prescription });
  } catch (error) { res.status(500).json({ message: 'Failed to create prescription.' }); }
});

router.post('/dentist/radiology-referrals', requireDentist, async (req, res) => {
  try {
    const { patientId, centerId, testIds, notes = '' } = req.body;
    if (!objectIdIsValid(patientId) || !objectIdIsValid(centerId) || !Array.isArray(testIds) || !testIds.length || testIds.length > 20) {
      return res.status(400).json({ message: 'Patient, radiology branch, and imaging types are required.' });
    }
    const [patient, center] = await Promise.all([User.findOne({ _id: patientId, role: 'User' }).select('_id fullName'), User.findOne({ _id: centerId, role: 'Radiology', activationStatus: 'active' }).select('fullName mobileNumber')]);
    if (!patient) return res.status(404).json({ message: 'Patient not found.' });
    if (!center || !isBurj(center)) return res.status(409).json({ message: 'The selected Al Burj branch is not active.' });
    const services = await MedicalTest.find({ _id: { $in: testIds }, providerId: center._id, type: 'radiology', isActive: true }).select('price name');
    if (services.length !== [...new Set(testIds)].length) return res.status(400).json({ message: 'One or more imaging types are unavailable.' });
    const originalCost = services.reduce((sum, service) => sum + (Number(service.price) || 0), 0);
    const pricingItems = services.map((service) => ({ testId: service._id, originalCost: Number(service.price) || 0, discountPercentage: 0, discountAmount: 0, finalCost: Number(service.price) || 0, vitaCommissionAmount: Number(((Number(service.price) || 0) * 0.05).toFixed(2)), providerNetAmount: Number(((Number(service.price) || 0) * 0.95).toFixed(2)) }));
    const request = await LabRequest.create({
      patientId, doctorId: req.user._id, labId: center._id, testIds,
      notes: String(notes).trim().slice(0, 1000), originalCost, totalCost: originalCost,
      vitaCommissionPercent: 5, vitaCommissionAmount: Number((originalCost * 0.05).toFixed(2)), providerNetAmount: Number((originalCost * 0.95).toFixed(2)),
      status: 'pending', approvalStatus: 'approved', requestedBy: req.user._id,
      sourceChannel: 'vita_partner_network',
      pricingItems,
    });
    try {
      if (center.mobileNumber && await isWhatsAppReady()) {
        const imagingNames = services.map((service) => service.name).join('، ');
        const message = `🔔 *طلب أشعة جديد عبر فيتا*\n\nالفرع: ${center.fullName}\nالطبيب المحوّل: ${req.user.fullName}\nالمريض: ${patient.fullName}\nالصور المطلوبة: ${imagingNames}\n\nيرجى الدخول إلى لوحة المركز لمراجعة الطلب.\nhttps://www.vita.ps/login`;
        await sendWhatsAppMessage(center.mobileNumber, message);
      }
    } catch (whatsappError) {
      console.warn(`Radiology referral WhatsApp notification failed for center ${center._id}:`, whatsappError.message);
    }
    res.status(201).json({ request });
  } catch (error) { res.status(500).json({ message: 'Failed to send radiology referral.' }); }
});

router.post('/dentist/reports', requireDentist, async (req, res) => {
  try {
    const { patientId, diagnosis, title = '', chiefComplaint = '', treatment = '', recommendations = '', notes = '', selectedTeeth = [], billing = {} } = req.body;
    if (!objectIdIsValid(patientId) || !String(diagnosis || '').trim() || !Array.isArray(selectedTeeth) || selectedTeeth.length === 0) return res.status(400).json({ message: 'Patient, diagnosis, and at least one treated tooth are required.' });
    const patient = await User.findOne({ _id: patientId, role: 'User' }).select('_id');
    if (!patient) return res.status(404).json({ message: 'Patient not found.' });
    const paymentMethod = String(billing.paymentMethod || 'cash');
    const totalAmount = Number(billing.totalAmount);
    const submittedPaidAmount = paymentMethod === 'cash' ? totalAmount : Number(billing.paidAmount || 0);
    if (!['cash', 'installment', 'insurance'].includes(paymentMethod) || !Number.isFinite(totalAmount) || totalAmount < 0 || !Number.isFinite(submittedPaidAmount) || submittedPaidAmount < 0 || submittedPaidAmount > totalAmount) {
      return res.status(400).json({ message: 'Invalid billing details.' });
    }
    if (paymentMethod === 'insurance' && (!String(billing.insuranceCompanyName || '').trim() || !String(billing.insuranceNumber || '').trim())) {
      return res.status(400).json({ message: 'Insurance company and patient insurance number are required.' });
    }
    const paidAmount = paymentMethod === 'insurance' ? 0 : submittedPaidAmount;
    const remainingAmount = Number((totalAmount - paidAmount).toFixed(2));
    const debtorType = remainingAmount <= 0 ? 'none' : paymentMethod === 'insurance' ? 'insurance' : 'patient';
    const cleanedTeeth = Array.isArray(selectedTeeth) ? selectedTeeth.slice(0, 32).map((tooth) => ({
      toothNumber: Number(tooth.toothNumber), toothName: String(tooth.toothName || '').slice(0, 80),
      position: String(tooth.position || '').slice(0, 80), condition: String(tooth.condition || '').slice(0, 80),
      conditionLabel: String(tooth.conditionLabel || '').slice(0, 80), notes: String(tooth.notes || '').slice(0, 500),
    })).filter((tooth) => Number.isInteger(tooth.toothNumber) && tooth.toothNumber >= 1 && tooth.toothNumber <= 32) : [];
    const record = await MedicalRecord.create({
      patient: patientId, doctor: req.user._id, date: new Date(),
      title: String(title).trim().slice(0, 200), chiefComplaint: String(chiefComplaint).trim().slice(0, 1000),
      diagnosis: String(diagnosis).trim().slice(0, 1000), treatment: String(treatment).trim().slice(0, 2000),
      recommendations: String(recommendations).trim().slice(0, 2000), notes: String(notes).trim().slice(0, 2000),
      selectedTeeth: cleanedTeeth, dentalTreatment: String(treatment).trim().slice(0, 2000), treatmentCost: totalAmount,
      billing: { paymentMethod, totalAmount, paidAmount, remainingAmount, debtorType, insuranceCompanyName: String(billing.insuranceCompanyName || '').trim().slice(0, 160), insuranceNumber: String(billing.insuranceNumber || '').trim().slice(0, 80) },
      partnerSourceChannel: 'vita_partner_network', vitaCommissionPercent: 5,
      vitaCommissionAmount: Number((paidAmount * 0.05).toFixed(2)),
      lastEditedBy: req.user._id, lastEditedAt: new Date(),
    });
    try {
      let financial = await Financial.findOne({ doctorId: req.user._id });
      if (!financial) financial = new Financial({ doctorId: req.user._id, transactions: [], expenses: [], debts: [] });
      const description = `Dental treatment - ${patientId} - ${record._id}`;
      if (paidAmount > 0) {
        financial.transactions.push({ amount: paidAmount, description, patientId, medicalRecordId: record._id, paymentMethod: 'Cash' });
        financial.totalEarnings = Number(financial.totalEarnings || 0) + paidAmount;
      }
      if (remainingAmount > 0) {
        financial.debts.push({
          ...(debtorType === 'patient' ? { patientId } : { insuredPatientId: patientId }),
          doctorId: req.user._id, medicalRecordId: record._id, amount: remainingAmount, originalAmount: remainingAmount,
          debtorType, insuranceCompanyName: debtorType === 'insurance' ? String(billing.insuranceCompanyName).trim().slice(0, 160) : '',
          insuranceNumber: debtorType === 'insurance' ? String(billing.insuranceNumber).trim().slice(0, 80) : '',
          description, status: 'pending',
        });
      }
      await financial.save();
    } catch (financialError) {
      await MedicalRecord.findByIdAndDelete(record._id);
      throw financialError;
    }
    res.status(201).json({ record, billing: record.billing });
  } catch (error) { res.status(500).json({ message: 'Failed to create dental report.' }); }
});

router.get('/radiology/requests', requireBurj, async (req, res) => {
  try {
    const filter = { labId: req.user._id };
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 15, 1), 50);
    if (req.query.status && ['pending', 'in_progress', 'completed', 'cancelled'].includes(req.query.status)) filter.status = req.query.status;
    const total = await LabRequest.countDocuments(filter);
    const requests = await LabRequest.find(filter).populate('patientId', 'fullName idNumber mobileNumber')
      .populate('doctorId', 'fullName specialty mobileNumber').populate('testIds', 'name category price description')
      .populate('pricingItems.testId', 'name category price')
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
    res.json({ requests, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (error) { res.status(500).json({ message: 'Failed to load radiology requests.' }); }
});

router.get('/radiology/accounts', requireBurj, async (req, res) => {
  try {
    const now = new Date();
    const year = Math.min(2100, Math.max(2020, Number(req.query.year) || now.getFullYear()));
    const month = Math.min(12, Math.max(1, Number(req.query.month) || now.getMonth() + 1));
    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd = new Date(Date.UTC(year, month, 1));
    const radiologyTestIds = await MedicalTest.find({ type: 'radiology' }).distinct('_id');
    const requests = await LabRequest.find({
      labId: req.user._id,
      status: 'completed',
      completedDate: { $gte: periodStart, $lt: periodEnd },
      testIds: { $in: radiologyTestIds },
      $or: [
        { sourceChannel: 'vita_partner_network' },
        { sourceChannel: { $exists: false }, doctorId: { $ne: null } },
        { sourceChannel: 'legacy', requestedBy: { $ne: null }, doctorId: { $ne: null } },
      ],
    }).select('patientId doctorId testIds completedDate createdAt totalCost vitaCommissionPercent vitaCommissionAmount providerNetAmount discount')
      .populate('patientId', 'fullName idNumber').populate('doctorId', 'fullName').populate('testIds', 'name type').sort({ completedDate: -1, createdAt: -1 }).lean();
    const rows = requests.map((request) => {
      const grossAmount = Number(request.totalCost) || 0;
      const vitaCommissionAmount = Number(request.vitaCommissionAmount ?? (grossAmount * 0.05));
      const providerNetAmount = Number(request.providerNetAmount ?? (grossAmount - vitaCommissionAmount));
      return { requestId: request._id, patientName: request.patientId?.fullName, patientIdNumber: request.patientId?.idNumber, doctorName: request.doctorId?.fullName, tests: request.testIds?.map((test) => test.name) || [], completedAt: request.completedDate, vitaCommissionPercent: 5, vitaCommissionAmount: Number(vitaCommissionAmount.toFixed(2)), providerNetAmount: Number(providerNetAmount.toFixed(2)), grossAmount: Number(grossAmount.toFixed(2)) };
    });
    const summary = rows.reduce((total, row) => ({
      completedReferrals: total.completedReferrals + 1,
      grossIncome: total.grossIncome + row.grossAmount,
      vitaCommission: total.vitaCommission + row.vitaCommissionAmount,
      centerNetIncome: total.centerNetIncome + row.providerNetAmount,
    }), { completedReferrals: 0, grossIncome: 0, vitaCommission: 0, centerNetIncome: 0 });
    Object.keys(summary).forEach((key) => { if (key !== 'completedReferrals') summary[key] = Number(summary[key].toFixed(2)); });
    res.json({ summary, rows, period: { year, month } });
  } catch (error) { res.status(500).json({ message: 'Failed to load radiology accounts.' }); }
});

router.delete('/radiology/requests/:requestId', requireBurj, async (req, res) => {
  try {
    const request = await LabRequest.findOneAndDelete({ _id: req.params.requestId, labId: req.user._id });
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    res.json({ message: 'Request deleted.' });
  } catch (error) { res.status(500).json({ message: 'Failed to delete request.' }); }
});

router.get('/radiology/services', requireBurj, async (req, res) => {
  try {
    const services = await MedicalTest.find({ providerId: req.user._id, type: 'radiology' })
      .select('name category description price estimatedDuration isActive createdAt').sort({ isActive: -1, category: 1, name: 1 }).lean();
    res.json({ services });
  } catch (error) { res.status(500).json({ message: 'Failed to load imaging services.' }); }
});

router.post('/radiology/services', requireBurj, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 160);
    const category = String(req.body.category || '').trim().slice(0, 120);
    const price = Number(req.body.price);
    if (!name || !category || !Number.isFinite(price) || price < 0) return res.status(400).json({ message: 'Name, category, and a valid price are required.' });
    const existing = await MedicalTest.findOne({ name });
    if (existing) return res.status(409).json({ message: 'An imaging service with this name already exists.' });
    const service = await MedicalTest.create({ name, category, price, type: 'radiology', providerId: req.user._id, createdBy: req.user._id, description: String(req.body.description || '').trim().slice(0, 1000), estimatedDuration: Math.min(Math.max(Number(req.body.estimatedDuration) || 30, 1), 1440), isActive: true });
    res.status(201).json({ service });
  } catch (error) { res.status(500).json({ message: 'Failed to create imaging service.' }); }
});

router.put('/radiology/services/:serviceId', requireBurj, async (req, res) => {
  try {
    const service = await MedicalTest.findOne({ _id: req.params.serviceId, providerId: req.user._id, type: 'radiology' });
    if (!service) return res.status(404).json({ message: 'Imaging service not found.' });
    const name = String(req.body.name || '').trim().slice(0, 160);
    const category = String(req.body.category || '').trim().slice(0, 120);
    const price = Number(req.body.price);
    if (!name || !category || !Number.isFinite(price) || price < 0) return res.status(400).json({ message: 'Name, category, and a valid price are required.' });
    const duplicate = await MedicalTest.findOne({ _id: { $ne: service._id }, name });
    if (duplicate) return res.status(409).json({ message: 'An imaging service with this name already exists.' });
    service.name = name; service.category = category; service.price = price;
    service.description = String(req.body.description || '').trim().slice(0, 1000);
    service.estimatedDuration = Math.min(Math.max(Number(req.body.estimatedDuration) || 30, 1), 1440);
    if (typeof req.body.isActive === 'boolean') service.isActive = req.body.isActive;
    await service.save(); res.json({ service });
  } catch (error) { res.status(500).json({ message: 'Failed to update imaging service.' }); }
});

router.delete('/radiology/services/:serviceId', requireBurj, async (req, res) => {
  try {
    const service = await MedicalTest.findOne({ _id: req.params.serviceId, providerId: req.user._id, type: 'radiology' });
    if (!service) return res.status(404).json({ message: 'Imaging service not found.' });
    const isUsed = await LabRequest.exists({ testIds: service._id });
    if (isUsed) { service.isActive = false; await service.save(); return res.json({ message: 'Service archived because it is linked to previous requests.', archived: true }); }
    await service.deleteOne(); res.json({ message: 'Imaging service deleted.', archived: false });
  } catch (error) { res.status(500).json({ message: 'Failed to delete imaging service.' }); }
});

router.patch('/radiology/requests/:requestId/discount', requireBurj, async (req, res) => {
  try {
    const discountPercentage = Number(req.body.discountPercentage);
    const submittedOriginalCost = req.body.originalCost === undefined ? null : Number(req.body.originalCost);
    const testId = req.body.testId;
    if (!Number.isFinite(discountPercentage) || discountPercentage < 0 || discountPercentage > 100) return res.status(400).json({ message: 'Discount must be between 0 and 100.' });
    if (submittedOriginalCost !== null && (!Number.isFinite(submittedOriginalCost) || submittedOriginalCost < 0)) return res.status(400).json({ message: 'Price must be zero or greater.' });
    if (!objectIdIsValid(testId)) return res.status(400).json({ message: 'Imaging type is required.' });
    const request = await LabRequest.findOne({ _id: req.params.requestId, labId: req.user._id }).populate('testIds', 'price');
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    if (!(request.testIds || []).some((test) => String(test._id) === String(testId))) return res.status(400).json({ message: 'Imaging type is not part of this request.' });
    const existingByTest = new Map((request.pricingItems || []).map((item) => [String(item.testId), item]));
    request.pricingItems = request.testIds.map((test) => {
      const existing = existingByTest.get(String(test._id));
      const original = String(test._id) === String(testId) && submittedOriginalCost !== null ? submittedOriginalCost : Number(existing?.originalCost ?? test.price) || 0;
      const itemDiscount = String(test._id) === String(testId) ? discountPercentage : Number(existing?.discountPercentage || 0);
      const discountAmount = Number((original * itemDiscount / 100).toFixed(2));
      const finalCost = Number((original - discountAmount).toFixed(2));
      const commission = Number((finalCost * 0.05).toFixed(2));
      return { testId: test._id, originalCost: original, discountPercentage: itemDiscount, discountAmount, finalCost, vitaCommissionAmount: commission, providerNetAmount: Number((finalCost - commission).toFixed(2)) };
    });
    request.originalCost = request.pricingItems.reduce((sum, item) => sum + item.originalCost, 0);
    request.discountAmount = request.pricingItems.reduce((sum, item) => sum + item.discountAmount, 0);
    request.totalCost = request.pricingItems.reduce((sum, item) => sum + item.finalCost, 0);
    request.discount = request.originalCost ? Number(((request.discountAmount / request.originalCost) * 100).toFixed(2)) : 0;
    request.vitaCommissionPercent = 5; request.vitaCommissionAmount = request.pricingItems.reduce((sum, item) => sum + item.vitaCommissionAmount, 0);
    request.providerNetAmount = request.pricingItems.reduce((sum, item) => sum + item.providerNetAmount, 0);
    await request.save();
    res.json({ request });
  } catch (error) { res.status(500).json({ message: 'Failed to update discount.' }); }
});

router.patch('/radiology/requests/:requestId/status', requireBurj, async (req, res) => {
  try {
    const status = req.body.status === 'in-progress' ? 'in_progress' : req.body.status;
    if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) return res.status(400).json({ message: 'Invalid status.' });
    const request = await LabRequest.findOne({ _id: req.params.requestId, labId: req.user._id });
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    request.status = status;
    if (status === 'completed') request.completedDate = new Date();
    await request.save();
    res.json({ request });
  } catch (error) { res.status(500).json({ message: 'Failed to update request status.' }); }
});

router.post('/radiology/requests/:requestId/results', requireBurj, resultUpload.array('files', 20), async (req, res) => {
  try {
    const request = await LabRequest.findOne({ _id: req.params.requestId, labId: req.user._id });
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    if (!req.files?.length) return res.status(400).json({ message: 'At least one supported result file is required.' });
    request.results.push(...req.files.map((file) => ({
      result: `${req.protocol}://${req.get('host')}/uploads/lab-results/${file.filename}`,
      attachments: [file.filename], notes: String(req.body.notes || '').trim().slice(0, 1000),
    })));
    request.status = 'completed'; request.completedDate = new Date();
    await request.save();
    res.json({ request });
  } catch (error) { res.status(500).json({ message: 'Failed to upload radiology results.' }); }
});

router.post('/radiology/patients', requireBurj, async (req, res) => {
  try {
    const { fullName, mobileNumber, idNumber, address, city = 'Nablus', country = 'Palestine', birthdate, sex } = req.body;
    if (!String(fullName || '').trim() || !String(mobileNumber || '').trim() || !idIsValid(idNumber) || !String(address || '').trim()) return res.status(400).json({ message: 'Name, mobile, ID number, and address are required.' });
    const exists = await User.findOne({ $or: [{ mobileNumber: String(mobileNumber).trim() }, { idNumber: String(idNumber).trim() }] }).select('_id');
    if (exists) return res.status(409).json({ message: 'A patient with this mobile or ID already exists.' });
    const temporaryPassword = `Vita-${crypto.randomBytes(6).toString('base64url')}`;
    const patient = await User.create({
      fullName: String(fullName).trim().slice(0, 120), mobileNumber: String(mobileNumber).trim(), idNumber: String(idNumber).trim(),
      address: String(address).trim().slice(0, 300), city: String(city).trim(), country: String(country).trim(), birthdate, sex,
      role: 'User', password: await bcrypt.hash(temporaryPassword, 12), activationStatus: 'active', isPhoneVerified: false,
    });
    res.status(201).json({ patient: publicPatient(patient), temporaryPassword });
  } catch (error) { res.status(500).json({ message: 'Failed to create patient account.' }); }
});

router.get('/pharmacy/prescriptions', requireSelectedPharmacy, async (req, res) => {
  try {
    const filter = { distributionChannel: 'vita_partner_network', isValid: true };
    if (req.query.idNumber) {
      if (!idIsValid(req.query.idNumber)) return res.status(400).json({ message: 'Invalid ID number.' });
      const patient = await User.findOne({ role: 'User', idNumber: String(req.query.idNumber).trim() }).select('_id');
      if (!patient) return res.json({ prescriptions: [] });
      filter.patientId = patient._id;
    }
    const prescriptions = await Prescription.find(filter).populate('patientId', 'fullName idNumber mobileNumber')
      .populate('doctorId', 'fullName specialty mobileNumber').populate('products.drugId', 'name genericName strength dosageForm')
      .sort({ createdAt: -1 }).limit(200).lean();
    const quotes = await PharmacyPrescriptionQuote.find({ pharmacy: req.user._id, prescription: { $in: prescriptions.map((item) => item._id) } }).lean();
    const quotesByPrescription = new Map(quotes.map((quote) => [String(quote.prescription), quote]));
    res.json({ prescriptions: prescriptions.map((item) => ({ ...item, pharmacyQuote: quotesByPrescription.get(String(item._id)) || null })) });
  } catch (error) { res.status(500).json({ message: 'Failed to load prescriptions.' }); }
});

router.put('/pharmacy/prescriptions/:prescriptionId/quote', requireSelectedPharmacy, async (req, res) => {
  try {
    const prescription = await Prescription.findOne({ _id: req.params.prescriptionId, distributionChannel: 'vita_partner_network', isValid: true });
    if (!prescription) return res.status(404).json({ message: 'Prescription not found.' });
    if (!Array.isArray(req.body.items) || req.body.items.length !== prescription.products.length) return res.status(400).json({ message: 'Pricing is required for every medicine.' });
    const byId = new Map(req.body.items.map((item) => [String(item.prescriptionProductId), item]));
    const items = prescription.products.map((product) => {
      const submitted = byId.get(String(product._id));
      const originalPrice = Number(submitted?.originalPrice);
      const discountedPrice = Number(submitted?.discountedPrice);
      if (!Number.isFinite(originalPrice) || !Number.isFinite(discountedPrice) || originalPrice < 0 || discountedPrice < 0 || discountedPrice > originalPrice) throw new Error('INVALID_PRICE');
      const discountPercentage = originalPrice === 0 ? 0 : Number((((originalPrice - discountedPrice) / originalPrice) * 100).toFixed(2));
      return { prescriptionProductId: product._id, originalPrice, discountedPrice, discountPercentage, vitaCommission: Number((discountedPrice * 0.02).toFixed(2)) };
    });
    const totals = items.reduce((value, item) => ({ original: value.original + item.originalPrice, discounted: value.discounted + item.discountedPrice, commission: value.commission + item.vitaCommission }), { original: 0, discounted: 0, commission: 0 });
    const quote = await PharmacyPrescriptionQuote.findOneAndUpdate(
      { prescription: prescription._id, pharmacy: req.user._id },
      { items, originalTotal: Number(totals.original.toFixed(2)), discountedTotal: Number(totals.discounted.toFixed(2)), vitaCommissionTotal: Number(totals.commission.toFixed(2)), status: 'priced' },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    res.json({ quote });
  } catch (error) {
    if (error.message === 'INVALID_PRICE') return res.status(400).json({ message: 'Discounted price cannot exceed original price.' });
    res.status(500).json({ message: 'Failed to save medicine prices.' });
  }
});

module.exports = router;
