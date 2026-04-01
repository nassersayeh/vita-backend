const mongoose = require('mongoose');

const ReferralSchema = new mongoose.Schema({
  referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  referredId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  referralCode: { type: String, required: true, unique: true },
  phoneNumber: {
    type: String,
    default: '' // Optional, with empty string as default
  },
  pointsEarned: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'completed', 'expired'], default: 'pending' },
  completedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Referral', ReferralSchema);
