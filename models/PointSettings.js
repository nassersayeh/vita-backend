const mongoose = require('mongoose');

const PointSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  pointValueIls: { type: Number, default: 0.1, min: 0 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('PointSettings', PointSettingsSchema);
