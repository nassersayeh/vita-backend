const Payment = require('../models/Payment');
const Order = require('../models/Order');
const Product = require('../models/Product');
const EPrescription = require('../models/EPrescription');
const Notification = require('../models/Notification');
const User = require('../models/User')

exports.createPayment = async (req, res) => {
  try {
    const { pharmacyId, orderData, paymentMethod, visaDetails, codDetails, user } = req.body;
    if (!pharmacyId || !orderData || !paymentMethod) {
      return res.status(400).json({ message: 'pharmacyId, orderData & paymentMethod required.' });
    }

    // 1) Determine status
    const status = paymentMethod === 'Visa' ? 'paid' : 'pending';

    // 2) Persist Payment record (raw)
    const paymentDoc = new Payment({ user, orderData, paymentMethod, visaDetails, codDetails, status ,pharmacyId});
    await paymentDoc.save();

    // 3) Build Order.items with proper ObjectIds and required fields
    const items = [];
    let total = 0;
    const method = (orderData.orderMethod || '').toLowerCase().replace(/[-\s]/g, '');
    console.log('Method:', method);

    if (method === 'store') {
      // Product orders
      for (const pid of orderData.products || []) {
        const p = await Product.findById(pid);
        if (p) {
          items.push({ onModel: 'Product', item: p._id, price: p.price, name: p.name });
          total += p.price;
        } else {
          throw new Error(`Product with ID ${pid} not found`);
        }
      }
    } else if (method === 'eprescriptions') {
      // E-Prescription orders
      for (const presc of orderData.ePrescriptions || []) {
        let prescDoc;
        if (presc) {
          prescDoc = await EPrescription.findById(presc);
        }
        if (prescDoc) {
          // Assuming EPrescription has a name and total or price field
          items.push({ onModel: 'EPrescription', item: prescDoc._id, price: prescDoc.total || 0, name: prescDoc.name || 'وصفة طبية' });
          total += prescDoc.total || 0; // Adjust based on your EPrescription schema
        }
      }
    } else if (method === 'attachment') {
      // File upload orders (no model reference)
      const filename = typeof orderData.attachment === 'object'
        ? orderData.attachment.filename
        : orderData.attachment;
      items.push({
        onModel: 'EPrescription', // or a separate model if you prefer
        item: null,
        price: 0, // Default price for attachment
        name: filename || 'مرفق'
      });
      // Note: attachments have no linked model, handle in front-end by checking item === null
    }

    // 4) Create the Order record
    const order = new Order({
      user,
      pharmacyId,
      items,
      total,
      status: status === 'paid' ? 'completed' : status
    });
    await order.save();

    const orderedUser = await User.findById(user);

    // Create notification for the pharmacy
    await Notification.create({
      user: pharmacyId,
      type: 'order',
      message: `لديك طلب جديد من المستخدم ${orderedUser.fullName || 'غير معروف'}`,
      relatedId: paymentDoc._id
    });

    res.status(201).json({ message: 'Processed', payment: paymentDoc, order });
  } catch (err) {
    console.error('Payment error:', err);
    res.status(500).json({ message: err.message || 'Server error during payment.' });
  }
};

exports.updatePaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    console.log('Updating order:', orderId, 'with status:', status);

    const order = await Payment.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }

    order.status = status || 'completed';
    const pharmacyAccount = await User.findById(order.pharmacyId);
    console.log('Pharmacy account:', pharmacyAccount);

   
    if (status === 'completed' || status === 'paid' || status === 'accepted') {
      console.log('Order items:', order.orderData.items);
      for (const item of order.orderData.items) {
        if (item.onModel === 'Product' && item.item || item.onModel === 'EPrescription') {
          console.log('Processing item:', item);
          const product = await Product.findOne({ _id: item.item, pharmacyId: order.pharmacyId });
          if (!product) {
            console.log(`Product not found for itemId: ${item.item}, pharmacyId: ${order.pharmacyId}`);
            return res.status(404).json({ message: `المنتج غير موجود: ${item.item}` });
          }
          if (product.amount < item.quantity) {
            return res.status(400).json({ message: `المخزون غير كافٍ لـ ${product.name} (متوفر: ${product.amount}, مطلوب: ${item.quantity})` });
          }
          product.amount -= item.quantity;
          const savedProduct = await product.save();
          if (!savedProduct) {
            return res.status(500).json({ message: `فشل في تحديث كمية ${product.name}` });
          }
          console.log(`Updated ${product.name} amount to ${product.amount}`);
        }
      }
    }
    await order.save();
    await Notification.create({
      user: order.user,
      type: 'request',
      message: `تم قبول طلبك من ${pharmacyAccount.fullName || 'غير معروف'}`,
      relatedId: order._id,
    });

    res.json({ message: 'تم تحديث حالة الطلب وتقليل الكميات إن وجد', order });
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).json({ message: 'خطأ في الخادم أثناء تحديث الطلب.' });
  }
};

exports.getPharmacyOrders = async (req, res) => {
  try {
    const { userId } = req.params;

    const orders = await Payment.find({ pharmacyId: userId })
      .populate({
        path: 'user',
        select: 'fullName email mobileNumber' // جلب كافة بيانات المستخدم المطلوبة
      })
      .populate({
        path: 'orderData.items.item',
        refPath: 'orderData.items.onModel', // يحدد النموذج بناءً على قيمة onModel
        match: { onModel: 'Product' }, // Populate only for Product
        select: 'name price' // جلب الحقول من Product
      })
      .lean() // للحصول على البيانات ككائنات عادية
      .exec();

    console.log('Raw orders:', orders); // Debug log

    const enrichedOrders = orders.map(order => {
      // Handle cases where orderData.items might be undefined
      const itemsToProcess = order.orderData?.items || [];

      order.items = itemsToProcess.map(item => {
        if (item.onModel === 'Product' && item.item) {
          return {
            ...item,
            details: {
              ...item.item, // Include Product details (name, price, etc.)
              quantity: item.quantity
            }
          };
        } else if (item.onModel === 'EPrescription') {
          return {
            ...item,
            details: {
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              ...item.prescriptionDetails, // Include prescription details
              products: item.prescriptionDetails?.products || [],
              doctorName: item.prescriptionDetails?.doctorId?.fullName || 'غير معروف' // Assuming doctorId is not populated here
            }
          };
        }
        return item;
      });

      // Fallback for old orders with products instead of items
      if (itemsToProcess.length === 0 && order.orderData?.products) {
        order.items = order.orderData.products.map(product => ({
          onModel: 'Product',
          name: product.name,
          price: product.price,
          quantity: product.quantity || 1,
          details: {
            name: product.name,
            price: product.price,
            quantity: product.quantity || 1
          }
        }));
      }

      return order;
    });

    res.json(enrichedOrders);
  } catch (err) {
    console.error('Error fetching pharmacy orders:', err);
    res.status(500).json({ message: 'Server error fetching orders.' });
  }
};