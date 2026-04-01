const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  orderData: { type: Object, required: true },
  paymentMethod: { 
    type: String, 
    enum: ['Visa', 'Cash on Delivery'], 
    required: true 
  },
  
  // For Visa payments
  visaDetails: {
    cardNumber: { type: String },
    expiry: { type: String },
    cvv: { type: String },
    cardholderName: { type: String },
  },
  // For Cash on Delivery payments
  codDetails: {
    address: { type: String },
    phoneNumber: { type: String },
  },
  status: { type: String, enum: ['pending', 'paid', 'cancelled','completed'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Payment', paymentSchema);
