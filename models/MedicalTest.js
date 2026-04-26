const mongoose = require('mongoose');

const NormalRangeSchema = new mongoose.Schema({
  gender: { type: String, enum: ['male', 'female', 'all'], default: 'all' },
  ageMin: { type: Number, default: 0 },   // in years
  ageMax: { type: Number, default: 999 }, // in years
  range: { type: String },
  unit: { type: String },
}, { _id: false });

const MedicalTestSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  type: { type: String, required: true, enum: ['laboratory', 'radiology', 'cardiology', 'other'] },
  category: { type: String, required: true },
  description: { type: String },
  normalRange: { type: String },          // legacy single string (kept for backward compat)
  normalRanges: [NormalRangeSchema],      // structured ranges by gender/age
  unit: { type: String },
  price: { type: Number, default: 0 },
  preparationInstructions: { type: String },
  estimatedDuration: { type: Number },    // in minutes
  isActive: { type: Boolean, default: true },
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

module.exports = mongoose.model('MedicalTest', MedicalTestSchema);
