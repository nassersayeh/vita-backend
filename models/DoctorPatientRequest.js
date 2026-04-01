const mongoose = require('mongoose');

const DoctorPatientRequestSchema = new mongoose.Schema({
  doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  message: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  respondedAt: { type: Date }
});

// Ensure unique doctor-patient request (no duplicates)
DoctorPatientRequestSchema.index({ doctor: 1, patient: 1 }, { unique: true });

module.exports = mongoose.model('DoctorPatientRequest', DoctorPatientRequestSchema);
