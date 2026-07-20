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
    const allowedCategories = /شرقي|الطبيخ|صحي|صحية|الصحيه|ساندويش|سندويش|سلطات|سلطة|oriental|healthy|sandwich|salad/i;
    const eligible = (catalog.menu || []).filter((product) => allowedCategories.test(product.category?.name || ''));
    const withNutrition = eligible.filter((product) => ['calories', 'protein', 'carbs', 'fat'].every((key) => product.nutrition?.[key] != null && Number.isFinite(Number(product.nutrition[key]))));
    if (!eligible.length) return res.status(422).json({ message: 'لا توجد أصناف ضمن الوجبات الشرقية والصحية والسندويشات والسلطات' });
    if (!withNutrition.length) return res.status(422).json({ message: 'يجب إدخال السعرات والبروتين والكارب والدهون للأصناف المؤهلة من لوحة Zest أولًا' });
    const bmi = weight / Math.pow(height / 100, 2);
    const offset = bmi >= 30 ? 0 : bmi < 20 ? 2 : 1;
    const days = Array.from({ length: 30 }, (_, index) => ({
      day: index + 1,
      meal: withNutrition[(index + offset) % withNutrition.length],
    }));
    const price = days.reduce((sum, day) => sum + Number(day.meal.sellingPrice || 0), 0);
    const nutritionTotals = days.reduce((totals, day) => {
      ['calories', 'protein', 'carbs', 'fat', 'fiber'].forEach((key) => { totals[key] += Number(day.meal.nutrition?.[key] || 0); });
      return totals;
    }, { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
    const dailyAverage = Object.fromEntries(Object.entries(nutritionTotals).map(([key, value]) => [key, Number((value / 30).toFixed(1))]));
    res.json({ durationDays: 30, bmi: Number(bmi.toFixed(1)), days, price, dailyAverage, eligibleMeals: withNutrition.length, missingNutrition: eligible.length - withNutrition.length, message: 'السعر هو مجموع أسعار وجبات الأيام الثلاثين من منيو زيست، دون سعر مفترض أو خصم.' });
  } catch (error) { next(error); }
});

router.get('/orders', auth, async (req, res, next) => {
  try {
    const orders = await HealthyFoodOrder.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ orders });
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

router.patch('/orders/:orderId/cancel', auth, async (req, res) => {
  try {
    const order = await HealthyFoodOrder.findOne({ _id: req.params.orderId, userId: req.user._id });
    if (!order) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (order.status === 'Cancelled') return res.json({ order });
    if (!['Pending', 'New'].includes(order.status)) {
      return res.status(422).json({ message: 'لا يمكن إلغاء الطلب بعد بدء تحضيره' });
    }

    await zestRequest(`/vita/orders/${order.zestOrderId}/cancel`, {
      method: 'PATCH',
      body: JSON.stringify({ cancellationReason: req.body.cancellationReason || 'أُلغي من تطبيق Vita' }),
    });

    if (!order.pointsReversed) {
      const points = await Points.findOneAndUpdate(
        { userId: order.userId },
        {
          $inc: { totalPoints: -order.pointsAwarded },
          $push: { pointsHistory: { points: -order.pointsAwarded, action: 'zest_order_cancelled', description: `إلغاء طلب زيست ${order.invoiceNumber}`, referenceId: order._id } },
        },
        { new: true }
      );
      if (points) await User.findByIdAndUpdate(order.userId, { totalPoints: points.totalPoints });
      order.pointsReversed = true;
    }
    order.status = 'Cancelled';
    await order.save();
    res.json({ order });
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
