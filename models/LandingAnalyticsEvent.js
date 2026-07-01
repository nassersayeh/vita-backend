const mongoose = require('mongoose');

const LandingAnalyticsEventSchema = new mongoose.Schema({
  eventType: {
    type: String,
    enum: ['visit', 'signup'],
    required: true,
    index: true,
  },
  visitId: { type: String, index: true },
  path: { type: String },
  referrer: { type: String },
  source: { type: String },
  language: { type: String },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  role: { type: String },
  country: { type: String },
  city: { type: String },
  occurredAt: { type: Date, default: Date.now, index: true },
  userAgent: { type: String },
  ip: { type: String },
}, { timestamps: true });

LandingAnalyticsEventSchema.index({ eventType: 1, occurredAt: -1 });
LandingAnalyticsEventSchema.index({ visitId: 1, eventType: 1 });

module.exports = mongoose.model('LandingAnalyticsEvent', LandingAnalyticsEventSchema);
