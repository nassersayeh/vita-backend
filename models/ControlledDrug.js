const mongoose = require('mongoose');
module.exports = mongoose.model('ControlledDrug', new mongoose.Schema({
  drugId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drug', required: true, unique: true },
  approved: { type: Boolean, default: false },
  audit: [{ action: String, actor: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true }));
