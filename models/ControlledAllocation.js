const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  quantity: { type: Number, required: true, min: 1, max: 1000, immutable: true },
  unitPrice: { type: Number, default: 2, immutable: true },
  syndicateShare: { type: Number, default: 1, immutable: true },
  vitaShare: { type: Number, default: 1, immutable: true },
  paid: { type: Boolean, default: false },
  ready: { type: Boolean, default: false },
  // Permanently consumed ticket slots; contains no prescription/patient data.
  retiredSlots: { type: [Number], default: [] },
  requestId: { type: String, required: true, unique: true, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'OversightAccount', required: true },
  paidAt: Date,
  audit: [{ action: String, actor: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true });
module.exports = mongoose.model('ControlledAllocation', schema);
