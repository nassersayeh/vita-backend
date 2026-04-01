const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const PharmacyInventory = require('../models/PharmacyInventory');
const Order = require('../models/Order');
const Financial = require('../models/Financial');
const PharmacyFinancial = require('../models/PharmacyFinancial');

// GET /api/orders/patient/:patientId - Get patient orders
router.get('/patient/:patientId', async (req, res) => {
  try {
    const { patientId } = req.params;
    const orders = await Order.find({ user: patientId }).populate('items.item');
    res.json(orders);
  } catch (error) {
    console.error('Error fetching patient orders:', error);
    res.status(500).json({ message: 'Server error fetching orders' });
  }
});

// GET /api/orders/pharmacy/:pharmacyId - Get pharmacy orders
router.get('/pharmacy/:pharmacyId', async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { date } = req.query;
    let query = { pharmacy: pharmacyId };
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lt: end };
    }
    const orders = await Order.find(query).populate('user', 'fullName phone').sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    console.error('Error fetching pharmacy orders:', error);
    res.status(500).json({ message: 'Server error fetching orders' });
  }
});

// POST /api/orders - Create new order
router.post('/', async (req, res) => {
  try {
    const orderData = req.body;
    const order = new Order(orderData);
    await order.save();
    res.status(201).json({ success: true, message: 'Order created successfully', order });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ message: 'Server error creating order' });
  }
});

// POST /api/orders/pos - Create POS order (pharmacy staff)
router.post('/pos', auth, async (req, res) => {
  try {
    const { pharmacyId, items = [], customerName, customerPhone, subtotal, tax, total, paymentMethod, status } = req.body;

    // Require authenticated user (pharmacy or employee)
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

    // Only allow pharmacies or pharmacy employees to create POS orders
    const allowedRoles = ['Pharmacy', 'PharmacyEmployee', 'Employee'];
    if (!allowedRoles.includes(req.user.role) && req.user.role !== 'Pharmacy') {
      // permit employees tied to pharmacy in a later enhancement
      // For now allow any authenticated user (if needed change this)
    }

    // Find or create customer user for provided phone
    let customer = null;
    if (customerPhone) {
      customer = await User.findOne({ mobileNumber: customerPhone });
      if (!customer) {
        // Create a lightweight guest user with placeholder required fields
        const tempPass = Math.random().toString(36).slice(-8) || 'guestpass';
        const hashed = await bcrypt.hash(tempPass, 10);
        const guestId = `guest-${Date.now()}`;
        const newUser = new User({
          fullName: customerName || 'Walk-in Customer',
          mobileNumber: customerPhone,
          password: hashed,
          country: 'N/A',
          city: 'N/A',
          idNumber: guestId,
          address: 'N/A',
          role: 'User',
          isPhoneVerified: false
        });
        // Save without running full validation if some required fields are missing
        await newUser.save({ validateBeforeSave: false });
        customer = newUser;
      }
    }

    // Map incoming items to Order schema (use drugId if available)
    const orderItems = items.map(i => ({
      onModel: 'Product',
      // item will be drugId when selling inventory items; fallback to productId
      item: i.drugId || i.productId || i._id || i.id,
      quantity: i.quantity || 1,
      name: i.name || i.productName || '',
      price: i.price || 0,
      inventoryId: i.inventoryId || null,
      drugId: i.drugId || null,
      details: i || {},
    }));

    // Compute subtotal and tax if provided/required
    const computedSubtotal = orderItems.reduce((s, it) => s + (it.price * it.quantity), 0);
    const vatApplied = !!req.body.includeVat;
    const vatRate = parseFloat(req.body.vatRate || 0) || 0;
    const taxAmount = vatApplied ? computedSubtotal * vatRate : (parseFloat(tax) || 0);
    const computedTotal = parseFloat(total) || (computedSubtotal + taxAmount);

    const order = new Order({
      user: customer ? customer._id : undefined,
      pharmacyId,
      items: orderItems,
      subtotal: computedSubtotal,
      taxAmount: taxAmount,
      vatApplied,
      vatRate,
      total: computedTotal,
      paymentMethod: req.body.paymentMethod || 'Cash',
      insuranceCompany: req.body.insuranceCompany,
      status: status || 'paid',
      orderType: 'manual'
    });

    await order.save();

    // Decrement inventory quantities when possible
    for (const it of orderItems) {
      try {
        let inv = null;
        if (it.inventoryId) {
          inv = await PharmacyInventory.findById(it.inventoryId);
        }
        if (!inv) {
          // try by drugId
          const drugIdToFind = it.drugId || it.item;
          inv = await PharmacyInventory.findOne({ pharmacyId, drugId: drugIdToFind });
        }
        if (inv) {
          inv.quantity = Math.max(0, (inv.quantity || 0) - it.quantity);
          await inv.save();
        }
      } catch (err) {
        console.warn('Failed to decrement inventory for item', it.item || it.drugId || it.inventoryId, err.message);
      }
    }

    // Save pharmacy customer record if both name and phone provided
    try {
      const PharmacyCustomer = require('../models/PharmacyCustomer');
      if (customerPhone && customerName) {
        const existingCust = await PharmacyCustomer.findOne({ pharmacyId, phone: customerPhone });
        if (!existingCust) {
          await new PharmacyCustomer({ pharmacyId, userId: customer?._id || null, name: customerName, phone: customerPhone }).save();
        }
      }
    } catch (err) {
      console.warn('Failed to save pharmacy customer:', err.message);
    }

    // Add amount to financials
    try {
      let financial = await Financial.findOne({ pharmacyId: pharmacyId });
      if (!financial) {
        financial = new Financial({ pharmacyId: pharmacyId, transactions: [], totalEarnings: 0 });
      }
      // Map frontend payment methods to Financial model enum values
      const mapPaymentMethod = (method) => {
        switch (method) {
          case 'cash': return 'Cash';
          case 'card': return 'Card';
          case 'insurance': return 'Insurance';
          default: return 'Cash';
        }
      };

      const txn = {
        amount: parseFloat(order.total) || 0,
        description: `POS sale - Order ${order._id}`,
        date: new Date(),
        orderId: order._id,
        paymentMethod: mapPaymentMethod(paymentMethod),
        patientId: customer?._id || null,
      };
      financial.totalEarnings += txn.amount;
      financial.transactions.push(txn);
      await financial.save();

      // Also add to PharmacyFinancial for dashboard revenue
      let pharmacyFinancial = await PharmacyFinancial.findOne({ pharmacyId: pharmacyId });
      if (!pharmacyFinancial) {
        pharmacyFinancial = new PharmacyFinancial({ pharmacyId: pharmacyId });
      }
      
      // Map frontend payment methods to display-friendly values
      const mapPaymentMethodDisplay = (method) => {
        switch (method) {
          case 'cash': return 'Cash';
          case 'card': return 'Card';
          case 'insurance': return 'Insurance';
          default: return 'Cash';
        }
      };

      pharmacyFinancial.transactions.push({
        transactionId: new mongoose.Types.ObjectId(),
        type: 'income',
        category: 'order',
        amount: parseFloat(order.total) || 0,
        description: `POS Order #${order._id.toString().slice(-6)}`,
        relatedId: order._id,
        relatedModel: 'Order',
        reference: order._id.toString(),
        paymentMethod: mapPaymentMethodDisplay(paymentMethod),
        status: 'completed',
        date: new Date(),
      });
      
      pharmacyFinancial.totalRevenue += parseFloat(order.total) || 0;
      pharmacyFinancial.monthlyRevenue += parseFloat(order.total) || 0;
      pharmacyFinancial.accountBalance += parseFloat(order.total) || 0;
      await pharmacyFinancial.save();
    } catch (err) {
      console.warn('Failed to add financial transaction for POS order:', err.message);
    }

    res.status(201).json({ success: true, message: 'POS order created', order });
  } catch (error) {
    console.error('Error creating POS order:', error);
    res.status(500).json({ message: 'Server error creating POS order', error: error.message });
  }
});

// PUT /api/orders/:orderId/status - Update order status
router.put('/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const previousStatus = order.status;
    order.status = status;
    await order.save();

    // If order is being accepted (confirmed), record revenue
    if (status === 'accepted' && previousStatus !== 'accepted') {

      try {
        const PharmacyFinancial = require('../models/PharmacyFinancial');
        let financial = await PharmacyFinancial.findOne({ pharmacyId: order.pharmacyId });

        if (!financial) {
          financial = new PharmacyFinancial({ pharmacyId: order.pharmacyId });
        }

        // Check if this order revenue is already recorded
        const existingTransaction = financial.transactions.find(
          t => t.relatedId && t.relatedId.toString() === order._id.toString()
        );

        if (!existingTransaction) {
          // Record order revenue
          financial.transactions.push({
            transactionId: new mongoose.Types.ObjectId(),
            type: 'income',
            category: 'order',
            amount: order.total,
            description: `Order #${order._id.toString().slice(-6)} confirmed`,
            relatedId: order._id,
            relatedModel: 'Order',
            reference: order._id.toString(),
            paymentMethod: 'Cash', // Default, can be updated
            status: 'completed',
            date: new Date(),
          });

          financial.totalRevenue += order.total;
          financial.monthlyRevenue += order.total;
          financial.accountBalance += order.total;
          await financial.save();
        }
      } catch (financialError) {
        console.error('Failed to record order revenue:', financialError);
        // Don't fail the order update if financial recording fails
      }
    }

    res.json({ success: true, message: 'Order status updated', order });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ message: 'Server error updating order status' });
  }
});

// PUT /api/orders/:orderId/complete - Complete order with payment method
router.put('/:orderId/complete', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { paymentMethod, insuranceCompany } = req.body;

    if (!paymentMethod || !['Cash', 'Card', 'Insurance'].includes(paymentMethod)) {
      return res.status(400).json({ message: 'Valid payment method is required (Cash, Card, or Insurance)' });
    }

    if (paymentMethod === 'Insurance' && !insuranceCompany) {
      return res.status(400).json({ message: 'Insurance company is required for insurance payments' });
    }

    const order = await Order.findById(orderId).populate('user');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.status !== 'ready') {
      return res.status(400).json({ message: 'Only orders with status "ready" can be completed' });
    }

    // Update order with payment info
    order.status = 'delivered';
    order.paymentMethod = paymentMethod;
    if (paymentMethod === 'Insurance') {
      order.insuranceCompany = insuranceCompany;
    }
    await order.save();

    // Record financial transaction
    try {
      const PharmacyFinancial = require('../models/PharmacyFinancial');
      let financial = await PharmacyFinancial.findOne({ pharmacyId: order.pharmacyId });

      if (!financial) {
        financial = new PharmacyFinancial({ pharmacyId: order.pharmacyId });
      }

      // Check if transaction already exists for this order
      const existingTransaction = financial.transactions.find(
        t => t.relatedId && t.relatedId.toString() === order._id.toString()
      );

      if (!existingTransaction) {
        if (paymentMethod === 'Insurance') {
          // Add to debts (insurance company owes money)
          const debtId = new mongoose.Types.ObjectId().toString();
          financial.debts.push({
            id: debtId,
            type: 'insurance-debt',
            amount: order.total,
            description: `Order #${order._id.toString().slice(-6)} - Insurance: ${insuranceCompany}`,
            patientName: order.user?.fullName || 'Customer',
            patientId: order.user?._id,
            patientPhone: order.user?.mobileNumber || '',
            date: new Date(),
            status: 'pending',
          });
          financial.totalDebts += order.total;
        } else {
          // Cash or Card - add to income
          financial.transactions.push({
            transactionId: new mongoose.Types.ObjectId(),
            type: 'income',
            category: 'order',
            amount: order.total,
            description: `Order #${order._id.toString().slice(-6)} completed`,
            relatedId: order._id,
            relatedModel: 'Order',
            reference: order._id.toString(),
            paymentMethod: paymentMethod,
            status: 'completed',
            date: new Date(),
          });

          financial.totalRevenue += order.total;
          financial.monthlyRevenue += order.total;
          financial.accountBalance += order.total;
        }
        
        await financial.save();
      }
    } catch (financialError) {
      console.error('Failed to record order completion financial:', financialError);
      // Don't fail the order update if financial recording fails
    }

    // If payment is by insurance, automatically add user to pharmacy's customer list
    if (paymentMethod === 'Insurance' && order.user) {
      try {
        const PharmacyCustomer = require('../models/PharmacyCustomer');
        
        // Check if customer already exists for this pharmacy
        let existingCustomer = await PharmacyCustomer.findOne({
          pharmacyId: order.pharmacyId,
          $or: [
            { userId: order.user._id },
            { phone: order.user.mobileNumber }
          ]
        });

        if (existingCustomer) {
          // Customer exists, update their insurance companies list if not already included
          if (!existingCustomer.insuranceCompanies.includes(insuranceCompany)) {
            existingCustomer.insuranceCompanies.push(insuranceCompany);
            await existingCustomer.save();
          }
        } else {
          // Create new customer entry
          const newCustomer = new PharmacyCustomer({
            pharmacyId: order.pharmacyId,
            userId: order.user._id,
            name: order.user.fullName || 'Online Customer',
            phone: order.user.mobileNumber || '',
            isOnline: true, // Mark as online customer (from Vita app order)
            insuranceCompanies: [insuranceCompany],
            notes: `Added automatically from online order #${order._id.toString().slice(-6)}`
          });
          await newCustomer.save();
        }
      } catch (customerError) {
        console.error('Failed to add customer to pharmacy list:', customerError);
        // Don't fail the order if customer addition fails
      }
    }

    res.json({ success: true, message: 'Order completed successfully', order });
  } catch (error) {
    console.error('Error completing order:', error);
    res.status(500).json({ message: 'Server error completing order' });
  }
});

module.exports = router;
