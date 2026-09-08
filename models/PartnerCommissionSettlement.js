const mongoose = require('mongoose');

const PartnerCommissionSettlementSchema = new mongoose.Schema({
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  providerType: { type: String, enum: ['pharmacy', 'radiology', 'dentist'], required: true, index: true },
  commissionRate: { type: Number, required: true, min: 0, max: 100 },
  grossAmount: { type: Number, required: true, min: 0 },
  vitaCommissionAmount: { type: Number, required: true, min: 0 },
  sourceCount: { type: Number, required: true, min: 1 },
  sourceIds: [{ type: mongoose.Schema.Types.ObjectId, required: true }],
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receivedAt: { type: Date, default: Date.now, required: true, index: true },
}, { timestamps: true });

PartnerCommissionSettlementSchema.index({ providerType: 1, receivedAt: -1 });

module.exports = mongoose.model('PartnerCommissionSettlement', PartnerCommissionSettlementSchema);
