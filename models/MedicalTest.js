const mongoose = require('mongoose');

const MedicalTestSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  type: { type: String, required: true, enum: ['laboratory', 'radiology', 'cardiology', 'other'] },
  category: { type: String, required: true },
  description: { type: String },
  normalRange: { type: String },
  unit: { type: String },
  price: { type: Number, default: 0 },
  preparationInstructions: { type: String },
  estimatedDuration: { type: Number }, // in minutes
  isActive: { type: Boolean, default: true },
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

module.exports = mongoose.model('MedicalTest', MedicalTestSchema);
