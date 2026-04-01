const mongoose = require('mongoose');

const AdminNotificationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  targetGroup: { type: String, enum: ['patients', 'doctors', 'pharmacies', 'labs', 'all'], required: true },
  targetUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // specific users if needed
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sentAt: { type: Date, default: Date.now },
  scheduledFor: { type: Date }, // for scheduled notifications
  status: { type: String, enum: ['draft', 'sent', 'scheduled'], default: 'sent' },
  deliveryStats: {
    totalSent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  },
  attachments: [{ type: String }] // file paths for attachments
}, { timestamps: true });

module.exports = mongoose.model('AdminNotification', AdminNotificationSchema);
