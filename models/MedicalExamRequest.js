const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  laboratoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  tests: { type: [String], required: true },
  notes: { type: String, default: '' },
  status: { type: String, enum: ['awaiting_laboratory', 'pending', 'completed'], required: true },
  results: { type: String, default: '' },
  completedAt: Date,
}, { timestamps: true });
schema.index({ doctorId: 1, patientId: 1, createdAt: -1 });
module.exports = mongoose.model('MedicalExamRequest', schema);
