const mongoose = require('mongoose');
const Financial = require('../models/Financial');
const User = require('../models/User');
const categories = { rent: ['General', 'ايجار'], salary: ['Salary', 'رواتب'], equipment: ['Equipment', 'معدات'], medicine: ['Inventory', 'ادوية'], tools: ['Equipment', 'ادوات'], personal: ['General', 'مصروف شخصي'], other: ['Other', 'اخرى'] };

exports.create = async (req, res) => {
  const { type, amount, reason, category, patientId } = req.body || {};
  if (!['payment', 'debt', 'expense'].includes(type) || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 10000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) return res.status(400).json({ message: 'أدخل مبلغاً موجباً بمنزلتين عشريتين كحد أقصى.' });
  if (type === 'expense' && !Object.hasOwn(categories, category)) return res.status(400).json({ message: 'اختر سبب المصروف.' });
  if ((type !== 'expense' || category === 'other') && (typeof reason !== 'string' || !reason.trim() || reason.length > 1000)) return res.status(400).json({ message: 'أدخل السبب، بحد أقصى ١٠٠٠ حرف.' });
  try {
    if (type !== 'expense') {
      if (!mongoose.isValidObjectId(patientId)) return res.status(400).json({ message: 'اختر المريض.' });
      if (!(req.user.patients || []).some(id => String(id) === patientId)) return res.status(403).json({ message: 'المريض غير مرتبط بحسابك.' });
      if (!await User.exists({ _id: patientId, role: 'User' })) return res.status(404).json({ message: 'المريض غير موجود.' });
    }
    const entry = { amount, date: new Date(), description: type === 'expense' ? (category === 'other' ? `اخرى: ${reason.trim()}` : categories[category][1]) : reason.trim() };
    let collection, increment;
    if (type === 'expense') { collection = 'expenses'; entry.category = categories[category][0]; increment = { totalExpenses: amount }; }
    else if (type === 'payment') { collection = 'transactions'; Object.assign(entry, { patientId, paymentMethod: 'Cash' }); increment = { totalEarnings: amount }; }
    else { collection = 'debts'; Object.assign(entry, { patientId, doctorId: req.user._id, debtorType: 'patient', originalAmount: amount, status: 'pending' }); }
    if (type === 'payment') {
      // Create the ledger if needed, then compare the debt snapshot on each atomic payment.
      await Financial.updateOne({ doctorId: req.user._id }, { $setOnInsert: { doctorId: req.user._id } }, { upsert: true });
      for (let attempt = 0; attempt < 5; attempt++) {
        const ledger = await Financial.findOne({ doctorId: req.user._id }).lean();
        const originalDebts = ledger.debts || [];
        const debts = originalDebts.map(debt => ({ ...debt }));
        let remaining = Math.round(amount * 100);
        const eligible = debts.filter(debt => String(debt.patientId || '') === patientId && debt.debtorType !== 'insurance' && debt.status === 'pending')
          .sort((a, b) => new Date(a.date) - new Date(b.date));
        for (const debt of eligible) {
          if (!remaining) break;
          const balance = Math.round(Number(debt.amount) * 100);
          if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('Invalid debt balance');
          const paid = Math.min(balance, remaining);
          debt.originalAmount = debt.originalAmount ?? debt.amount;
          debt.amount = (balance - paid) / 100;
          remaining -= paid;
          if (debt.amount === 0) { debt.status = 'paid'; debt.paidAt = entry.date; }
        }
        const result = await Financial.updateOne({ _id: ledger._id, doctorId: req.user._id, debts: originalDebts }, {
          $set: { debts }, $push: { transactions: entry }, $inc: { totalEarnings: amount },
        }, { runValidators: true });
        if (result.modifiedCount) return res.status(201).json({ success: true });
      }
      return res.status(409).json({ message: 'تغير الحساب أثناء الحفظ. يرجى المحاولة مجدداً.' });
    }
    await Financial.updateOne({ doctorId: req.user._id }, { $push: { [collection]: entry }, ...(increment ? { $inc: increment } : {}) }, { upsert: true, runValidators: true });
    return res.status(201).json({ success: true });
  } catch { return res.status(500).json({ message: 'تعذر حفظ الحركة المالية.' }); }
};

exports.report = async (req, res) => {
  try {
    const Appointment = require('../models/Appointment');
    const MedicalRecord = require('../models/MedicalRecord');
    const [ledgers, appointments, records] = await Promise.all([
      Financial.find({ doctorId: req.user._id }).select('transactions expenses debts').populate('transactions.patientId debts.patientId', 'fullName').lean(),
      Appointment.find({ doctorId: req.user._id }).select('bookingSource status isPaid autoMarkedAsPaid paymentAmount appointmentDateTime').lean(),
      MedicalRecord.find({ doctor: req.user._id, 'billing.paidAmount': { $gt: 0 } }).select('vitaCommissionAmount').lean(),
    ]);
    res.set('Cache-Control', 'no-store');
    res.json(require('../utils/doctorAccountsReport')(ledgers, appointments, records));
  } catch { res.status(500).json({ message: 'تعذر تحميل التقرير المالي.' }); }
};
