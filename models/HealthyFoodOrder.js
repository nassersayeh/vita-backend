const mongoose = require('mongoose');

const HealthyFoodOrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  zestOrderId: { type: String, required: true, unique: true },
  invoiceNumber: { type: String, default: '' },
  kind: { type: String, enum: ['menu', 'subscription', 'program'], default: 'menu' },
  total: { type: Number, default: 0 },
  status: { type: String, default: 'Pending' },
  pointsAwarded: { type: Number, default: 5 },
  pointsReversed: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('HealthyFoodOrder', HealthyFoodOrderSchema);
