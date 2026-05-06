
// controllers/orderController.js
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const PharmacyInventory = require('../models/PharmacyInventory');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Points = require('../models/Points');
const EPrescription = require('../models/EPrescription');
const Financial = require('../models/Financial');
const { sendWhatsAppMessage } = require('../services/whatsappService');

exports.createOrder = async (req, res) => {
  try {
    const {
      pharmacyId,
      city,
      user,
      items,
      total,
      status,
      orderType,
      prescriptionId,
      prescriptionImage,
      prescriptionNotes,
      paymentMethod,
      deliveryMethod,
      deliveryAddress
    } = req.body;
    console.log('Received request body:', req.body);

    if (!user || !items || total === undefined || total === null) {
      return res.status(400).json({ message: 'Missing required order fields (user, items, or total).' });
    }

    if (!pharmacyId && !city) {
      return res.status(400).json({ message: 'City is required for admin medicine orders.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Items array is required and must not be empty.' });
    }

    // Check if prescription is one-time and already ordered
    if (prescriptionId && orderType === 'prescription') {
      try {
        const prescription = await EPrescription.findById(prescriptionId);
        if (prescription && prescription.validityType === 'one-time') {
          // Check if an order already exists for this one-time prescription
          const existingOrder = await Order.findOne({ prescriptionId: prescriptionId });
          if (existingOrder) {
            return res.status(400).json({ 
              message: 'This is a one-time prescription and has already been ordered. You cannot create another order with it.' 
            });
          }
        }
      } catch (prescriptionError) {
        console.warn('Error checking prescription validity:', prescriptionError);
        // Continue with order creation even if prescription check fails
      }
    }

    // Process and validate items
    const processedItems = [];
    for (const item of items) {
      if (!item.onModel || !item.quantity || !item.name || !item.price) {
        console.warn(`Invalid item structure: ${JSON.stringify(item)}`);
        continue; // Skip invalid items but allow order to proceed
      }

      if (item.onModel === 'Product') {
        // Accept both ObjectId and product name as item reference
        // (product names are used when prescriptions don't have productId)
        if (!item.item) {
          console.warn(`Missing item ID for product ${item.name}`);
          continue; // Skip items without ID or name
        }
        processedItems.push({
          onModel: 'Product',
          item: item.item, // Can be ObjectId or product name string
          quantity: item.quantity,
          name: item.name,
          price: item.price
        });
      } else if (item.onModel === 'EPrescription') {
        // Expand prescription details into individual items
        if (!item.prescriptionDetails || !Array.isArray(item.prescriptionDetails.products)) {
          console.warn(`Invalid prescriptionDetails for item ${item.name}`);
          continue;
        }

        console.log('mathched : '+item.prescriptionDetails.products)
        for (const product of item.prescriptionDetails.products) {
          const matchedProduct = pharmacyId ? await Product.findOne({ name: product.name, pharmacyId }) : null;
          processedItems.push({
            onModel: 'Product', // Treat as Product to link with store
            item: matchedProduct ? matchedProduct._id : null,
            quantity: item.quantity,
            name: product.name,
            price: matchedProduct ? matchedProduct.price || item.price : item.price,
            prescriptionDetails: {
              doctorId: item.prescriptionDetails.doctorId,
              doctorName: item.prescriptionDetails.doctorName,
              date: item.prescriptionDetails.date,
              doses: product.dose,
              originalPrescriptionId: item.item // Reference to the ePrescription
            }
          });
        }
      }
    }

    if (processedItems.length === 0) {
      console.error('No valid items after processing:', items);
      return res.status(400).json({ message: 'No valid items to process.' });
    }

    const finalTotal = Number(total);
    const newOrder = new Order({
      pharmacyId: pharmacyId || null,
      city: city || deliveryAddress?.city || '',
      user,
      items: processedItems,
      total: finalTotal,
      status: status || 'pending',
      orderType: orderType || 'manual',
      prescriptionId: prescriptionId || null,
      prescriptionImage: prescriptionImage || null,
      prescriptionNotes: prescriptionNotes || '',
      paymentMethod: paymentMethod || 'Cash',
      deliveryMethod: deliveryMethod || 'pickup',
      deliveryAddress: deliveryAddress || null
    });
    await newOrder.save();
    console.log('Saved order:', newOrder);

    // Award points to the patient (points = order total)
    try {
      let userPoints = await Points.findOne({ userId: user });
      if (!userPoints) {
        userPoints = new Points({ userId: user });
      }

      const pointsToAdd = Math.floor(finalTotal); // Award points equal to order total
      userPoints.totalPoints += pointsToAdd;
      userPoints.pointsHistory.push({
        points: pointsToAdd,
        action: 'order',
        description: `Order points - Order #${newOrder._id}`,
        referenceId: newOrder._id
      });

      await userPoints.save();

      // Update user's total points
      const patientUser = await User.findById(user);
      if (patientUser) {
        patientUser.totalPoints = userPoints.totalPoints;
        await patientUser.save({ validateBeforeSave: false });
        console.log(`Awarded ${pointsToAdd} points to user ${user} for order`);
      }
    } catch (pointsError) {
      console.error('Error awarding points:', pointsError);
      // Don't fail the order creation if points award fails
    }

    // Get patient user details for notification
    let patientName = 'غير معروف';
    try {
      console.log('Searching for user with ID:', user, 'Type:', typeof user);
      let patientUserData = await User.findById(user).lean();
      
      // Try alternative ID format if not found
      if (!patientUserData && typeof user === 'string') {
        console.log('User not found by _id, trying with alternate formats...');
        patientUserData = await User.findOne({ _id: user }).lean();
      }
      
      console.log('Found patient user:', patientUserData);
      if (patientUserData && patientUserData.fullName) {
        patientName = patientUserData.fullName;
        console.log('Successfully retrieved patient name:', patientName);
      } else {
        console.log('Patient user data found but no fullName:', patientUserData);
      }
    } catch (userLookupError) {
      console.error('Error looking up patient name:', userLookupError);
    }

    console.log('Creating notification with patient name:', patientName);
    if (pharmacyId) {
      await Notification.create({
        user: pharmacyId,
        type: 'order',
        message: `لديك طلب جديد من المستخدم ${patientName}`,
        relatedId: newOrder._id
      });
    } else {
      const admins = await User.find({ role: { $in: ['Admin', 'Superadmin'] } }).select('_id').lean();
      if (admins.length > 0) {
        await Notification.insertMany(admins.map(admin => ({
          user: admin._id,
          type: 'order',
          message: `طلب أدوية جديد من ${patientName}${city ? ` - ${city}` : ''}`,
          relatedId: newOrder._id
        })));
      }
    }

    res.status(201).json({ message: 'تم إنشاء الطلب بنجاح', order: newOrder });
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({ message: 'خطأ في الخادم أثناء إنشاء الطلب.', error: err.message });
  }
};

exports.getAdminOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      $or: [
        { pharmacyId: null },
        { pharmacyId: { $exists: false } }
      ]
    })
      .populate('user', 'fullName email mobileNumber idNumber city address')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean()
      .exec();

    res.json({ orders });
  } catch (err) {
    console.error('Error fetching admin orders:', err);
    res.status(500).json({ message: 'Server error fetching admin orders.' });
  }
};

exports.getUserOrders = async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(userId)
    const orders = await Order.find({ user: userId })
    res.json(orders);
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ message: 'Server error fetching orders.' });
  }
};

exports.getPharmacyOrders = async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { date } = req.query;

    let query = { pharmacyId: pharmacyId };

    // Add date filter if date is provided
    if (date) {
      // Filter by date string to avoid timezone issues
      // Get start and end of the day in UTC
      const targetDate = new Date(date + 'T00:00:00.000Z'); // Treat as UTC start of day
      const nextDay = new Date(targetDate);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);

      query.createdAt = {
        $gte: targetDate,
        $lt: nextDay
      };
    }

    const orders = await Order.find(query)
      .populate({
        path: 'user',
        select: 'fullName email mobileNumber' // جلب كافة بيانات المستخدم المطلوبة
      })
      .populate({
        path: 'items.item',
        refPath: 'items.onModel', // يحدد النموذج بناءً على قيمة onModel
        match: { onModel: 'Product' }, // Populate only for Product
        select: 'name price' // جلب الحقول من Product
      })
      .lean() // للحصول على البيانات ككائنات عادية
      .exec();

    // تعديل البيانات لتضمين كافة التفاصيل
    const enrichedOrders = orders.map(order => {
      order.items = order.items.map(item => {
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
      return order;
    });

    res.json(enrichedOrders);
  } catch (err) {
    console.error('Error fetching pharmacy orders:', err);
    res.status(500).json({ message: 'Server error fetching orders.' });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId)
      .populate('user', 'fullName email mobileNumber gender dateOfBirth')
      .populate('pharmacyId', 'fullName email mobileNumber')
      .populate({
        path: 'prescriptionId',
        populate: [
          {
            path: 'patientId',
            select: 'fullName email mobileNumber gender'
          },
          {
            path: 'doctorId',
            select: 'fullName specialty email mobileNumber'
          }
        ]
      })
      .exec();

    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    res.json({ order });
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};


exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    console.log('Updating order:', orderId, status);

    // Find the order with populated user data
    const order = await Order.findById(orderId).populate('user', 'fullName mobileNumber');
    if (!order) {
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }

    // Validate status transitions
    const validTransitions = {
      pending: ['accepted', 'declined', 'cancelled'],
      accepted: ['preparing', 'ready', 'delivery_assigned', 'cancelled'],
      preparing: ['ready', 'delivery_assigned', 'cancelled'],
      ready: ['delivery_assigned', 'shipped', 'delivered', 'cancelled'],
      delivery_assigned: ['shipped', 'delivered', 'cancelled'],
      shipped: ['delivered', 'cancelled'],
      delivered: ['completed', 'cancelled'],
      completed: [],
    };

    if (!validTransitions[order.status] || !validTransitions[order.status].includes(status)) {
      return res.status(400).json({
        message: `لا يمكن تغيير الحالة من ${order.status} إلى ${status}`
      });
    }

    const previousStatus = order.status;
    order.status = status;

    // Update status timestamp based on new status
    const now = new Date();
    if (status === 'accepted') {
      order.acceptedAt = now;
    } else if (status === 'preparing') {
      order.preparingStartedAt = now;
    } else if (status === 'delivery_assigned') {
      order.deliveryAssignedAt = now;
    } else if (status === 'shipped') {
      order.shippedAt = now;
    } else if (status === 'delivered') {
      order.deliveredAt = now;
    }

    // Add to statusHistory for audit trail
    if (!order.statusHistory) {
      order.statusHistory = [];
    }
    
    // Determine who changed the status
    let changedBy = null;
    if (req.user?._id) {
      changedBy = req.user._id;
    } else if (req.body.changedBy && typeof req.body.changedBy === 'string' && req.body.changedBy.match(/^[0-9a-fA-F]{24}$/)) {
      // Valid ObjectId format
      changedBy = req.body.changedBy;
    } else if (mongoose.Types.ObjectId.isValid(req.body.changedBy)) {
      changedBy = req.body.changedBy;
    } else {
      // Default to null if no valid user ID is provided
      changedBy = null;
    }
    
    order.statusHistory.push({
      status: status,
      changedAt: now,
      changedBy: changedBy,
      notes: req.body.notes || null
    });

    await order.save();

    // Get pharmacy details for notifications
    const pharmacyAccount = order.pharmacyId ? await User.findById(order.pharmacyId) : null;
    const isAdminOrder = !order.pharmacyId;

    // Handle different status changes
    if (status === 'accepted') {
      // Add to pharmacy revenue
      if (order.pharmacyId) try {
        let financial = await Financial.findOne({ pharmacyId: order.pharmacyId });
        if (!financial) {
          financial = new Financial({ pharmacyId: order.pharmacyId });
        }

        financial.transactions.push({
          amount: order.total,
          description: `طلب #${orderId.slice(-6)} - تم القبول`,
          date: new Date(),
          orderId: order._id,
          paymentMethod: 'Cash',
        });

        financial.totalEarnings += order.total;
        await financial.save();
        console.log('Revenue added for accepted order:', order.total);
      } catch (financialError) {
        console.error('Error updating financial record:', financialError);
      }

      // Decrease product quantities
      if (order.pharmacyId) {
        console.log('Processing stock decrease for order items:', JSON.stringify(order.items));
        for (const item of order.items) {
          console.log(`Processing item: ${item.name}, onModel: ${item.onModel}, item ref: ${item.item}, quantity: ${item.quantity}`);

          if (item.onModel === 'Product' && item.quantity > 0) {
            try {
              let product = null;

              if (item.item) {
                product = await Product.findOne({ _id: item.item, pharmacyId: order.pharmacyId });
              }

              if (!product && item.name) {
                product = await Product.findOne({ name: item.name, pharmacyId: order.pharmacyId });
                console.log(`Product not found by ID, searching by name "${item.name}":`, product ? 'Found' : 'Not found');
              }

              if (product) {
                const previousAmount = product.amount;
                if (product.amount < item.quantity) {
                  console.warn(`Insufficient stock for ${product.name} (available: ${product.amount}, requested: ${item.quantity})`);
                }
                product.amount = Math.max(0, product.amount - item.quantity);
                product.totalSold = (product.totalSold || 0) + item.quantity;
                product.lastSoldDate = new Date();
                await product.save();
                console.log(`Product stock decreased for ${product.name}: ${previousAmount} -> ${product.amount}`);
              } else {
                console.warn(`Product not found for item: ${item.name} (ID: ${item.item})`);
              }

              // Update PharmacyInventory
              try {
                const inventoryItem = await PharmacyInventory.findOne({
                  pharmacyId: order.pharmacyId,
                  drugName: item.name
                });

                if (inventoryItem) {
                  const previousQuantity = inventoryItem.quantity;
                  inventoryItem.quantity = Math.max(0, inventoryItem.quantity - item.quantity);
                  inventoryItem.soldCount = (inventoryItem.soldCount || 0) + item.quantity;
                  inventoryItem.lastSoldDate = new Date();
                  await inventoryItem.save();
                  console.log(`PharmacyInventory stock decreased for ${item.name}: ${previousQuantity} -> ${inventoryItem.quantity}`);
                }
              } catch (inventoryError) {
                console.error(`Error updating PharmacyInventory for item ${item.name}:`, inventoryError);
              }
            } catch (productError) {
              console.error(`Error updating product stock for item ${item.name}:`, productError);
            }
          }
        }
      }

      // Send WhatsApp message for accepted order
      if (order.user?.mobileNumber) {
        try {
          const sourceName = isAdminOrder ? 'إدارة Vita' : (pharmacyAccount?.fullName || 'الصيدلية');
          const message = `مرحباً ${order.user.fullName || 'عميلنا العزيز'}\n\nتم قبول طلبك من ${sourceName}.\n\nرقم الطلب: #${orderId.slice(-6)}\n\nسنبدأ بتحضير طلبك قريباً.`;
          await sendWhatsAppMessage(order.user.mobileNumber, message);
          console.log('WhatsApp message sent for accepted order');
        } catch (whatsappError) {
          console.error('Error sending WhatsApp message for accepted order:', whatsappError);
        }
      }

      // Create in-app notification
      await Notification.create({
        user: order.user._id,
        type: 'order',
        message: `تم قبول طلبك رقم #${orderId.slice(-6)}`,
        relatedId: order._id
      });

    } else if (status === 'preparing') {
      // Send WhatsApp message for preparing status
      if (order.user?.mobileNumber) {
        try {
          const message = `👨‍⚕️ *تحديث حالة الطلب*\n\n${order.user.fullName || 'عميلنا العزيز'}، بدأنا بتحضير طلبك!\n\nرقم الطلب: #${orderId.slice(-6)}\n\nسيتم إعلامك عندما يكون جاهزاً للاستلام.`;
          await sendWhatsAppMessage(order.user.mobileNumber, message);
          console.log('WhatsApp message sent for preparing order');
        } catch (whatsappError) {
          console.error('Error sending WhatsApp message for preparing order:', whatsappError);
        }
      }

      // Create in-app notification
      await Notification.create({
        user: order.user._id,
        type: 'order',
        message: `بدأنا بتحضير طلبك رقم #${orderId.slice(-6)}`,
        relatedId: order._id
      });

    } else if (status === 'ready') {
      // Send WhatsApp message for ready status with order details
      if (order.user?.mobileNumber) {
        try {
          let itemsList = '';
          order.items.forEach((item, index) => {
            itemsList += `${index + 1}. ${item.name} - ${item.quantity} × ${item.price}₪\n`;
          });

          const sourceName = isAdminOrder ? 'Vita' : (pharmacyAccount?.fullName || 'صيدلتنا');
          const message = `طلبك جاهز للاستلام!\n\n${order.user.fullName || 'عميلنا العزيز'}، طلبك رقم #${orderId.slice(-6)} جاهز.\n\nتفاصيل الطلب:\n${itemsList}\nالمجموع: ${order.total}₪\n\nشكراً لشرائك من ${sourceName}.`;
          await sendWhatsAppMessage(order.user.mobileNumber, message);
          console.log('WhatsApp message sent for ready order');
        } catch (whatsappError) {
          console.error('Error sending WhatsApp message for ready order:', whatsappError);
        }
      }

      // Create in-app notification
      await Notification.create({
        user: order.user._id,
        type: 'order',
        message: `طلبك رقم #${orderId.slice(-6)} جاهز للاستلام`,
        relatedId: order._id
      });
    } else if (status === 'delivered' || status === 'completed' || status === 'cancelled' || status === 'declined') {
      const statusMessages = {
        delivered: `تم تسليم طلبك رقم #${orderId.slice(-6)}`,
        completed: `تم إكمال طلبك رقم #${orderId.slice(-6)}`,
        cancelled: `تم إلغاء طلبك رقم #${orderId.slice(-6)}`,
        declined: `تعذر قبول طلبك رقم #${orderId.slice(-6)}`,
      };
      await Notification.create({
        user: order.user._id,
        type: 'order',
        message: statusMessages[status],
        relatedId: order._id
      });
    }

    res.json({
      message: 'تم تحديث حالة الطلب بنجاح',
      order,
      previousStatus,
      newStatus: status
    });
  } catch (err) {
    console.error('Error updating order status:', err);
    res.status(500).json({ message: 'خطأ في الخادم أثناء تحديث الطلب.' });
  }
};

exports.deleteOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const deleted = await Order.findByIdAndDelete(orderId);
    if (!deleted) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json({ message: 'Order deleted successfully' });
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(500).json({ message: 'Server error deleting order.' });
  }
};

exports.askForPrescription = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { message } = req.body;

    const order = await Order.findById(orderId).populate('user', 'fullName email mobileNumber');
    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    // Create notification to patient asking for prescription
    const pharmacy = await User.findById(order.pharmacyId);
    await Notification.create({
      user: order.user._id,
      type: 'request',
      message: `${pharmacy?.fullName || 'صيدلية'} تطلب منك وصفة طبية للطلب #${orderId.slice(-6)}${message ? ': ' + message : ''}`,
      relatedId: orderId
    });

    // Update order to mark that prescription was requested
    order.prescriptionRequested = true;
    order.prescriptionRequestedAt = new Date();
    await order.save();

    res.json({ 
      message: 'Prescription request sent to patient',
      order 
    });
  } catch (err) {
    console.error('Error asking for prescription:', err);
    res.status(500).json({ message: 'Server error.' });
  }
};
