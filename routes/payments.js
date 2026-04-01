const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const Payment = require('../models/Payment')



router.post('/', paymentController.createPayment);
router.put('/order/:orderId', paymentController.updatePaymentStatus);
router.get('/pharmacyorders/:userId', paymentController.getPharmacyOrders);

// GET /api/payments/user/:userId - fetch payment records (orders) for a given user
router.get('/user/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const payments = await Payment.find({ pharmacyId: userId });
      console.log(payments)
      res.json(payments);
    } catch (error) {
      console.error("Error fetching payments:", error);
      res.status(500).json({ message: "Server error while fetching payments" });
    }
  });

  router.get('/patient/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const payments = await Payment.find({ user: userId });
      res.json(payments);
    } catch (error) {
      console.error("Error fetching payments:", error);
      res.status(500).json({ message: "Server error while fetching payments" });
    }
  });

  router.put('/:orderId/cancel', async (req, res) => {
    try {
      const order = await Order.findById(req.params.orderId);
      if (!order) return res.status(404).json({ message: 'Order not found' });
      if (order.payment.status !== 'pending') return res.status(400).json({ message: 'Order cannot be cancelled' });
      order.payment.status = 'cancelled';
      await order.save();
      res.json({ message: 'Order cancelled successfully', order });
    } catch (error) {
      res.status(500).json({ message: 'Server error' });
    }
  });
  
  // (Optional) GET /api/payments/:paymentId - fetch details for a specific payment
  router.get('/:paymentId', async (req, res) => {
    try {
      const { paymentId } = req.params;
      const payment = await Payment.findById(paymentId);
      if (!payment) return res.status(404).json({ message: 'Payment not found' });
      res.json({ payment });
    } catch (error) {
      console.error("Error fetching payment details:", error);
      res.status(500).json({ message: "Server error while fetching payment details" });
    }
  });
  
module.exports = router;
