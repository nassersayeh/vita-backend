const { getMobileCandidates } = require('./mobileNumber');
async function findPrescriptionPatient(User, value) {
  if (typeof value !== 'string') throw Object.assign(new Error('أدخل رقم الهوية أو الموبايل.'), { status: 400 });
  const query = value.trim();
  if (query.length < 5 || query.length > 30 || !/^[\p{L}\d+\s()-]+$/u.test(query)) throw Object.assign(new Error('رقم الهوية أو الموبايل غير صحيح.'), { status: 400 });
  const conditions = [{ idNumber: query }];
  if (/^[+\d\s()-]+$/.test(query) && query.replace(/\D/g, '').length >= 7) conditions.push({ mobileNumber: { $in: getMobileCandidates(query) } });
  const patients = await User.find({ role: 'User', $or: conditions }).select('_id').limit(2);
  if (patients.length > 1) throw Object.assign(new Error('الرقم يطابق أكثر من مريض. استخدم رقم الهوية لتحديد المريض.'), { status: 409 });
  return patients[0]?._id || null;
}
const patientOrderFilter = pharmacyId => ({ pharmacyId, user: { $ne: null }, status: { $ne: 'paid' }, $or: [{ adminApprovalStatus: 'approved' }, { adminApprovalStatus: { $exists: false } }] });
module.exports = { findPrescriptionPatient, patientOrderFilter };
