const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  laboratoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  price: { type: Number, required: true, min: 0 },
  category: { type: String, default: 'Routine' },
  normalRange: { type: String, default: '' },
  unit: { type: String, default: '' },
  fields: [{ label: { type: String, required: true, maxlength: 120 }, unit: String, normalRange: String }],
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
schema.index({ laboratoryId: 1, name: 1 }, { unique: true });
module.exports = mongoose.model('LaboratoryService', schema);
