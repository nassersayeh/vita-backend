// routes/invoice.js
const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const PDFDocument = require('pdfkit');
const path = require('path');

router.get('/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    console.log(`Generating invoice for paymentId: ${paymentId}`);
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      console.error('Payment not found for invoice generation.');
      return res.status(404).json({ message: 'Payment not found' });
    }
    
    // Create a new PDF document
    const doc = new PDFDocument();
    
    // Set headers for PDF download
    res.setHeader('Content-Disposition', 'attachment; filename=invoice.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    
    // Pipe PDF into response
    doc.pipe(res);
    
    // Add Vita logo stamp: load image file from assets
    const logoPath = path.join(__dirname, '../assets/vitalogogreen.png');
    // Draw the logo in the center of the page as a stamp with low opacity
    doc.opacity(0.2);
    doc.image(logoPath, doc.page.width / 2 - 75, doc.page.height / 2 - 75, { width: 150 });
    // Reset opacity for other content
    doc.opacity(1);

    // Add Invoice Title and Payment Details
    doc.fontSize(20).text('Invoice', { align: 'center' });
    doc.moveDown();
    doc.fontSize(16).text(`Payment ID: ${payment._id}`);
    doc.text(`Payment Method: ${payment.paymentMethod}`);
    doc.text(`Status: ${payment.status}`);
    doc.text(`Date: ${payment.createdAt.toDateString()}`);
    doc.moveDown();
    
    // Add Order Details
    doc.fontSize(14).text('Order Details:');
    console.log(payment)
    if (payment.orderData.method === 'store' && payment.orderData.products) {
      payment.orderData.products.forEach((prod, index) => {
        doc.text(`${index + 1}. ${prod.name} - $${prod.price.toFixed(2)}`);
      });
    } else if (payment.orderData.method === 'e-prescription' && payment.orderData.ePrescriptions) {
      payment.orderData.ePrescriptions.forEach((presc, index) => {
        doc.text(`${index + 1}. ${presc}`);
      });
    } else if (payment.orderData.method === 'attachment') {
      doc.text('Prescription uploaded.');
    }
    
    // Finalize PDF and end stream
    doc.end();
  } catch (error) {
    console.error('Invoice generation error:', error);
    res.status(500).json({ message: 'Error generating invoice.' });
  }
});

module.exports = router;
