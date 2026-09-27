const mongoose = require('mongoose');
module.exports = mongoose.model('ControlledSecurityEvent', new mongoose.Schema({
  requestId: { type: String, required: true, unique: true },
  actor: { type: mongoose.Schema.Types.ObjectId, required: true },
  role: { type: String, required: true },
  method: String,
  route: String,
  recordId: String,
  status: Number,
  at: { type: Date, default: Date.now, index: true },
}, { versionKey: false }));
