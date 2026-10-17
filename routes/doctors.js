// routes/doctors.js
const express = require('express');
const router = express.Router();
const doctorsController = require('../controllers/doctorsController');
const doctorPatientController = require('../controllers/doctorPatientController');
const User = require('../models/User');
const auth = require('../middleware/auth');

const bcrypt = require('bcryptjs');
const { validatePasswordPolicy } = require('../utils/passwordPolicy');
const { salesPasswordLimiter } = require('../middleware/authRateLimiter');
router.post('/password', auth, (req, res, next) => {
  if (req.user.role !== 'Doctor') return res.status(403).json({ message: 'غير مصرح بهذا الإجراء.' });
  res.set('Cache-Control', 'no-store');
  next();
}, salesPasswordLimiter, async (req, res) => {
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

// ============ STATIC ROUTES (MUST BE FIRST) ============
// Doctor-patient connection static routes
router.get('/search-patients', auth, doctorPatientController.searchPatients);
router.post('/create-patient', auth, doctorPatientController.createPatient);
router.get('/:doctorId/connected-patients', auth, doctorPatientController.getDoctorPatients);

// Reset patient password (doctor can reset password for their patients)
router.post('/:doctorId/patients/:patientId/reset-password', auth, doctorPatientController.resetPatientPassword);

// GET all users who have role === 'Doctor'
router.get('/', doctorsController.getAllDoctors);
router.get('/specialties', doctorsController.getSpecialties);
router.get('/cities', doctorsController.getCities);
router.get('/filter', doctorsController.filterDoctors);

// ============ DYNAMIC ROUTES (AFTER STATIC) ============
// New route to get a specific doctor by ID
router.get('/:doctorId', async (req, res) => {
  const doctorId = req.params.doctorId
  console.log("DoctorId " +doctorId)
    try {
      const doctor = await User.findOne({ _id: doctorId, role: 'Doctor' })
      if (!doctor) {
        return res.status(404).json({ message: 'Doctor not found' });
      }
      res.json({ doctor });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error fetching doctor details' });
    }
  });

// Update doctor workplaces
router.put('/:doctorId/workplaces', auth, require('../middleware/accountAuthorization').ownerOrAdmin('doctorId'), doctorsController.updateWorkplaces);

module.exports = router;
