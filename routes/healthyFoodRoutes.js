const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Points = require('../models/Points');
const HealthyFoodOrder = require('../models/HealthyFoodOrder');

const router = express.Router();
const zestUrl = () => (process.env.ZEST_API_URL || 'http://localhost:5050/api').replace(/\/$/, '');
const zestHeaders = () => ({ 'Content-Type': 'application/json', 'X-Vita-Key': process.env.VITA_ZEST_SHARED_KEY || 'change-me' });

const zestRequest = async (path, options = {}) => {
  const response = await fetch(`${zestUrl()}${path}`, { ...options, headers: { ...zestHeaders(), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || 'تعذر الاتصال بزيست'), { status: response.status });
  return data;
};

router.get('/catalog', auth, async (_req, res, next) => {
  try { res.json(await zestRequest('/vita/catalog')); } catch (error) { next(error); }
});

router.put('/profile', auth, async (req, res, next) => {
  try {
    const height = Number(req.body.height);
    const weight = Number(req.body.weight);
    if (height < 100 || height > 250 || weight < 30 || weight > 300) return res.status(422).json({ message: 'يرجى إدخال طول ووزن صحيحين' });
    req.user.height = height;
    req.user.weight = weight;
    await req.user.save();
    res.json({ height, weight });
  } catch (error) { next(error); }
});

router.post('/program', auth, async (req, res, next) => {
  try {
    const height = Number(req.body.height || req.user.height);
    const weight = Number(req.body.weight || req.user.weight);
    if (!height || !weight) return res.status(422).json({ message: 'الطول والوزن مطلوبان' });
    req.user.height = height; req.user.weight = weight; await req.user.save();
    const catalog = await zestRequest('/vita/catalog');
    const plans = catalog.subscriptions || [];
    if (!plans.length) return res.status(422).json({ message: 'لا توجد اشتراكات صحية متاحة في زيست حاليًا' });
    if (!catalog.menu?.length) return res.status(422).json({ message: 'لا توجد وجبات متاحة لبناء البرنامج حاليًا' });
    const bmi = weight / Math.pow(height / 100, 2);
    const recommended = plans[Math.min(plans.length - 1, bmi >= 30 ? 0 : bmi < 20 ? plans.length - 1 : Math.floor(plans.length / 2))];
    const offset = bmi >= 30 ? 0 : bmi < 20 ? 2 : 1;
    const days = Array.from({ length: 30 }, (_, index) => ({
      day: index + 1,
      meal: catalog.menu[(index + offset) % catalog.menu.length],
    }));
    res.json({ durationDays: 30, bmi: Number(bmi.toFixed(1)), recommended, days, price: recommended.sellingPrice, message: 'اقتراح عام مبني على القياسات، وليس بديلاً عن أخصائي تغذية.' });
  } catch (error) { next(error); }
});

router.post('/orders', auth, async (req, res, next) => {
  try {
    const payload = {
      items: req.body.items,
      kind: req.body.kind || 'menu',
      customerFirstName: req.user.fullName,
      customerPhone: req.user.mobileNumber,
      customerAddress: req.body.address || req.user.address || '',
      vitaUserId: String(req.user._id),
      notes: req.body.notes || '',
    };
    const zest = await zestRequest('/vita/orders', { method: 'POST', body: JSON.stringify(payload) });
    const order = await HealthyFoodOrder.create({
      userId: req.user._id, zestOrderId: zest.order._id, invoiceNumber: zest.order.invoiceNumber,
      kind: payload.kind, total: zest.order.total, status: zest.order.status,
    });
    const points = await Points.findOneAndUpdate(
      { userId: req.user._id },
      { $inc: { totalPoints: 5 }, $push: { pointsHistory: { points: 5, action: 'zest_order', description: `طلب زيست ${zest.order.invoiceNumber}`, referenceId: order._id } } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    await User.findByIdAndUpdate(req.user._id, { totalPoints: points.totalPoints });
    res.status(201).json({ order: zest.order, pointsAwarded: 5, totalPoints: points.totalPoints });
  } catch (error) { res.status(error.status || 500).json({ message: error.message }); }
});

router.post('/webhook/cancelled', async (req, res, next) => {
  try {
    if (req.header('X-Vita-Key') !== (process.env.VITA_ZEST_SHARED_KEY || 'change-me')) return res.status(401).json({ message: 'Unauthorized' });
    const order = await HealthyFoodOrder.findOne({ zestOrderId: req.body.zestOrderId });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (!order.pointsReversed) {
      const points = await Points.findOneAndUpdate({ userId: order.userId }, {
        $inc: { totalPoints: -order.pointsAwarded },
        $push: { pointsHistory: { points: -order.pointsAwarded, action: 'zest_order_cancelled', description: `إلغاء طلب زيست ${order.invoiceNumber}`, referenceId: order._id } }
      }, { new: true });
      if (points) await User.findByIdAndUpdate(order.userId, { totalPoints: points.totalPoints });
      order.pointsReversed = true;
    }
    order.status = 'Cancelled'; await order.save();
    res.json({ ok: true });
  } catch (error) { next(error); }
});

module.exports = router;
