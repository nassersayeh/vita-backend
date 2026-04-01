// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: ['appointment', 'order', 'request', 'patientappointment', 'payment', 'subscription', 'doctor_connect_request', 'points_gift'], 
    required: true 
  },
  message: { type: String, required: true },
  relatedId: { type: mongoose.Schema.Types.ObjectId, required: false },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', notificationSchema);