const mongoose = require('mongoose');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const Notification = require('../models/Notification');
const controller = require('./appointmentController');
const scope = req => ({ doctorId: req.user._id, clinicId: null });
async function owned(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return Appointment.findOne({ ...scope(req), _id: req.params.id });
}
async function slots(req, appointment, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return [];
  const workplace = (req.user.workplaces || []).find(w => w.name === appointment.workplaceName && w.isActive !== false);
  if (!workplace) return [];
  let payload, code = 200;
  await controller.getAvailableTimeSlots({ query: { doctorId: String(req.user._id), workplaceName: appointment.workplaceName, date, excludeAppointmentId: appointment._id ? String(appointment._id) : undefined, duration: appointment.durationMinutes || 30 } }, { status(n) { code = n; return this; }, json(data) { payload = data; } });
  if (code !== 200) throw new Error('Availability failed');
  return payload.timeSlots || [];
}
exports.list = async (req, res) => {
  try { const filter = scope(req); if (req.query.patientId) { if (!mongoose.isValidObjectId(req.query.patientId)) return res.status(400).json({ message: 'المريض غير صالح.' }); filter.patient = req.query.patientId; } res.set('Cache-Control', 'no-store'); res.json({ appointments: await Appointment.find(filter).populate('patient', 'fullName mobileNumber address city').sort({ appointmentDateTime: -1 }).lean() }); }
  catch { res.status(500).json({ message: 'تعذر تحميل المواعيد.' }); }
};
exports.slots = async (req, res) => {
  try { const appointment = await owned(req); if (!appointment) return res.status(404).json({ message: 'الموعد غير موجود.' }); res.json({ timeSlots: await slots(req, appointment, req.query.date) }); }
  catch { res.status(500).json({ message: 'تعذر تحميل الأوقات المتاحة.' }); }
};
exports.update = async (req, res) => {
  try {
    const appointment = await owned(req);
    if (!appointment) return res.status(404).json({ message: 'الموعد غير موجود.' });
    const { action, reason, date, time } = req.body || {};
    if (!['accept', 'cancel', 'reschedule'].includes(action)) return res.status(400).json({ message: 'إجراء غير صالح.' });
    if (!['pending', 'confirmed'].includes(appointment.status) || (action === 'accept' && appointment.status !== 'pending')) return res.status(409).json({ message: 'حالة الموعد لا تسمح بهذا الإجراء. حدّث القائمة.' });
    let update = {}, message;
    if (action === 'cancel') {
      if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000) return res.status(400).json({ message: 'اكتب سبب الإلغاء (حتى ١٠٠٠ حرف).' });
      update = { status: 'cancelled', cancellationReason: reason.trim(), cancelledAt: new Date(), blockedSlot: false };
      message = `تم إلغاء موعدك لدى د. ${req.user.fullName}. سبب الإلغاء: ${reason.trim()}`;
    } else if (action === 'accept') {
      if (new Date(appointment.appointmentDateTime) <= new Date()) return res.status(400).json({ message: 'لا يمكن قبول موعد مضى وقته.' });
      update = { status: 'confirmed' }; message = `تم قبول موعدك لدى د. ${req.user.fullName}.`;
    } else {
      const available = await slots(req, appointment, date);
      if (!available.some(slot => slot.start === time)) return res.status(409).json({ message: 'الوقت غير متاح. اختر وقتاً آخر.' });
      const target = new Date(`${date}T${time}:00`);
      if (!Number.isFinite(target.getTime()) || target <= new Date()) return res.status(400).json({ message: 'اختر موعداً مستقبلياً.' });
      update = { appointmentDateTime: target, status: 'confirmed', reminderDaySent: false, reminder30MinSent: false };
      message = `تم تغيير موعدك لدى د. ${req.user.fullName} إلى ${date} الساعة ${time}.`;
    }
    const updated = await Appointment.findOneAndUpdate({ ...scope(req), _id: appointment._id, status: appointment.status, appointmentDateTime: appointment.appointmentDateTime }, { $set: update }, { new: true, runValidators: true }).populate('patient', 'fullName mobileNumber address city');
    if (!updated) return res.status(409).json({ message: 'تغير الموعد أثناء الحفظ. حدّث القائمة.' });
    if (action !== 'cancel') await User.updateOne({ _id: req.user._id }, { $addToSet: { patients: appointment.patient } });
    // Persist the reason on the appointment even if notification delivery fails.
    await Notification.create({ user: appointment.patient, type: 'appointment', relatedId: appointment._id, message }).catch(() => {});
    res.json({ appointment: updated });
  } catch (error) { res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'هذا الوقت محجوز. اختر وقتاً آخر.' : 'تعذر تحديث الموعد.' }); }
};

exports.newSlots = async (req, res) => {
  try { res.json({ timeSlots: await slots(req, { workplaceName: req.query.workplaceName, durationMinutes: 30 }, req.query.date) }); }
  catch { res.status(500).json({ message: 'تعذر تحميل الأوقات.' }); }
};
exports.create = async (req, res) => {
  try {
    const { patientId, workplaceName, date, time, reason } = req.body || {};
    if (!mongoose.isValidObjectId(patientId) || !(req.user.patients || []).some(id => String(id) === patientId)) return res.status(403).json({ message: 'اختر مريضاً مرتبطاً بحسابك.' });
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000) return res.status(400).json({ message: 'أدخل سبب الزيارة (حتى ١٠٠٠ حرف).' });
    if (!await User.exists({ _id: patientId, role: 'User' })) return res.status(404).json({ message: 'المريض غير موجود.' });
    const available = await slots(req, { workplaceName, durationMinutes: 30 }, date);
    if (!available.some(slot => slot.start === time)) return res.status(409).json({ message: 'الوقت غير متاح. اختر وقتاً آخر.' });
    const appointmentDateTime = new Date(`${date}T${time}:00`);
    if (!Number.isFinite(appointmentDateTime.getTime()) || appointmentDateTime <= new Date()) return res.status(400).json({ message: 'اختر موعداً مستقبلياً.' });
    const workplace = req.user.workplaces.find(w => w.name === workplaceName && w.isActive !== false);
    const appointment = await Appointment.create({ doctorId: req.user._id, patient: patientId, appointmentDateTime, workplaceName, workplaceAddress: workplace.address, reason: reason.trim(), durationMinutes: 30, status: 'confirmed', bookingSource: 'manual', createdBy: req.user._id });
    await Notification.create({ user: patientId, type: 'appointment', relatedId: appointment._id, message: `تم حجز موعد لك لدى د. ${req.user.fullName} بتاريخ ${date} الساعة ${time}.` }).catch(() => {});
    res.status(201).json({ appointment });
  } catch (error) { res.status(error.code === 11000 ? 409 : 500).json({ message: error.code === 11000 ? 'الوقت محجوز. اختر وقتاً آخر.' : 'تعذر إنشاء الموعد.' }); }
};
