const { dispenseUploadedOrder } = require('../utils/dispenseUploadedOrder');
exports.dispense = async (req, res) => {
  try {
    const order = await dispenseUploadedOrder({ orderId: req.params.orderId, pharmacy: req.user, lines: req.body.items });
    // Dispensing is committed before optional notification; a notification failure cannot undo the sale.
    try { await require('../models/Notification').create({ user: order.user, type: 'order', relatedId: order._id, message: 'تم صرف الأدوية المتوفرة من طلبك. يمكنك مراجعة الأصناف والأسعار من تفاصيل الطلب.' }); } catch (error) { console.error('Dispensed order notification failed:', error.name); }
    res.json({ order });
  } catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : 'Could not dispense the order.' }); }
};
exports.history = async (req, res) => {
  try {
    const id = req.params.patientId;
    if (!/^[a-f\d]{24}$/i.test(String(id))) return res.status(400).json({ message: 'Invalid patient.' });
    const self = req.user.role === 'User' && String(req.user._id) === id;
    const linkedDoctor = req.user.role === 'Doctor' && (req.user.patients || []).some(patient => String(patient._id || patient) === id);
    if (!self && !linkedDoctor) return res.status(403).json({ message: 'This patient is not linked to your account.' });
    const page = Number(req.query.page || 1), pageSize = 25;
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return res.status(400).json({ message: 'Invalid page.' });
    const Order = require('../models/Order');
    const filter = { user: id, orderType: 'upload', dispensedAt: { $type: 'date' }, status: 'completed', adminApprovalStatus: 'approved' };
    const [orders, total] = await Promise.all([
      Order.find(filter).select('items.name items.quantity items.price items.drugId items.isSubstitute items.originalDrugName dispensedAt pharmacyId')
        .populate('pharmacyId', 'fullName').sort({ dispensedAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      Order.countDocuments(filter),
    ]);
    res.json({ orders, page, totalPages: Math.ceil(total / pageSize), total });
  } catch { res.status(500).json({ message: 'Could not load dispensed medicines.' }); }
};
