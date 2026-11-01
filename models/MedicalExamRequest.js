const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  laboratoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  tests: { type: [String], required: true },
  notes: { type: String, default: '' },
  status: { type: String, enum: ['awaiting_laboratory', 'pending', 'in_progress', 'completed'], required: true },
  results: { type: String, default: '' },
  resultDraft: { type: [{ name: String, value: String }], default: [], select: false },
  deletedAt: { type: Date, default: null },
  pricing: [{ name: String, price: { type: Number, min: 0, required: true }, originalCost: Number,
    discountPercentage: { type: Number, min: 0, max: 100 }, discountAmount: Number,
    vitaCommissionPercent: Number, vitaCommissionAmount: Number, providerNetAmount: Number }],
  totalCost: { type: Number, min: 0, default: 0 },
  completedAt: Date,
}, { timestamps: true });
schema.index({ doctorId: 1, patientId: 1, createdAt: -1 });
schema.index({ laboratoryId: 1, status: 1, completedAt: -1 });
module.exports = mongoose.model('MedicalExamRequest', schema);
