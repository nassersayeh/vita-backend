const Prescription = require('../models/EPrescription');
const { assertOrdinaryAllowed } = require('../utils/ordinaryControlledGuard');
module.exports = async (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  try {
    const doctorId = req.body?.doctorId;
    // Issuing in another doctor's name is never accepted from these legacy clients.
    if (doctorId && (req.user.role !== 'Doctor' || String(doctorId) !== String(req.user._id))) return res.status(403).json({ message: 'لا يمكن كتابة وصفة باسم طبيب آخر.' });
    const products = req.body?.medications || req.body?.products;
    if (products !== undefined) {
      if (!Array.isArray(products) || products.length > 100 || products.some(p => !p || typeof p !== 'object')) return res.status(400).json({ message: 'Invalid products.' });
      await assertOrdinaryAllowed(products, req.user);
    }
    const ids = (req.path.match(/[a-f\d]{24}/ig) || []).slice(0, 5);
    if (typeof req.body?.prescriptionId === 'string' && /^[a-f\d]{24}$/i.test(req.body.prescriptionId)) ids.push(req.body.prescriptionId);
    if (ids.length) {
      const prescriptions = await Prescription.find({ _id: { $in: ids } }).select('products doctorId');
      for (const prescription of prescriptions) {
        await assertOrdinaryAllowed(prescription.products, req.user);
        await assertOrdinaryAllowed(prescription.products, prescription.doctorId);
      }
    }
    if (req.body?.pharmacyId && (req.user.role !== 'Pharmacy' || String(req.body.pharmacyId) !== String(req.user._id))) return res.status(403).json({ message: 'لا يمكن صرف وصفة باسم صيدلية أخرى.' });
    next();
  } catch (error) {
    res.status(error.status || 503).json({ message: error.code === 'CONTROLLED_REQUIRED' ? error.message : 'تعذر التحقق من أدوية الوصفة. حاول لاحقاً.' });
  }
};
