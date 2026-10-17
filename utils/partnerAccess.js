const Clinic = require('../models/Clinic');
const normalize = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g, '').replace(/أ|إ|آ/g, 'ا');
const isDentist = user => ['dentist', 'dental', 'dentistry', 'اسنان'].some(term => normalize(user?.specialty).includes(term));
async function usesLegacyClinicDashboard(user) {
  const clinics = await Clinic.find({ $or: [{ name: /الشعب|al[\s-]*shaab/i }, { _id: '69ce33c830727c24d322fdee' }] }).select('_id ownerId doctors.doctorId staff.userId').lean();
  const id = String(user._id);
  return clinics.some(clinic => String(clinic._id) === String(user.clinicId) || String(clinic.ownerId) === id || (clinic.doctors || []).some(row => String(row.doctorId) === id) || (clinic.staff || []).some(row => String(row.userId) === id));
}
module.exports = { isDentist, usesLegacyClinicDashboard };
