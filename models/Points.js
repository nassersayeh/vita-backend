const mongoose = require('mongoose');

const PointsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  totalPoints: { type: Number, default: 0 },
  dailyLoginStreak: { type: Number, default: 0 },
  lastLoginDate: { type: Date },
  spinWheelLastUsed: { type: Date },
  lastMonthlyBonusDate: { type: Date }, // Track last time monthly bonus was awarded
  pointsHistory: [{
    points: { type: Number, required: true },
    action: { type: String, required: true }, // 'daily_login', 'appointment', 'order', 'test', 'image', 'spin_wheel', 'monthly_bonus'
    description: { type: String },
    referenceId: { type: mongoose.Schema.Types.ObjectId }, // Link to appointment/order/test/image
    date: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

module.exports = mongoose.model('Points', PointsSchema);
