const mongoose = require('mongoose');
module.exports = mongoose.model('ControlledAccess', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  unionApproved: { type: Boolean, default: false },
  ministrySuspended: { type: Boolean, default: false },
  audit: [{ action: String, actor: String, reason: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true }));
