const mongoose = require('mongoose');

const QuoteItemSchema = new mongoose.Schema({
  prescriptionProductId: { type: mongoose.Schema.Types.ObjectId, required: true },
  originalPrice: { type: Number, required: true, min: 0 },
  discountedPrice: { type: Number, required: true, min: 0 },
  discountPercentage: { type: Number, required: true, min: 0, max: 100 },
  vitaCommission: { type: Number, required: true, min: 0 },
}, { _id: false });

const PharmacyPrescriptionQuoteSchema = new mongoose.Schema({
  prescription: { type: mongoose.Schema.Types.ObjectId, ref: 'EPrescription', required: true, index: true },
  pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: { type: [QuoteItemSchema], default: [] },
  originalTotal: { type: Number, required: true, min: 0 },
  discountedTotal: { type: Number, required: true, min: 0 },
  vitaCommissionTotal: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['draft', 'priced', 'dispensed'], default: 'priced' },
  vitaSettlement: { type: mongoose.Schema.Types.ObjectId, ref: 'PartnerCommissionSettlement', default: null, index: true },
}, { timestamps: true });

PharmacyPrescriptionQuoteSchema.index({ prescription: 1, pharmacy: 1 }, { unique: true });

module.exports = mongoose.model('PharmacyPrescriptionQuote', PharmacyPrescriptionQuoteSchema);
