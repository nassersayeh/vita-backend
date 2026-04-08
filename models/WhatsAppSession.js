const mongoose = require('mongoose');

const whatsAppSessionSchema = new mongoose.Schema({
  // Session identifier: 'system' for admin, 'doctor_<id>' for doctors, 'pharmacy_<id>' for pharmacies
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  // Auth credentials (the entire baileys auth state)
  creds: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  // Auth keys stored as individual documents for efficiency
  keys: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // Connection status
  status: {
    type: String,
    enum: ['connected', 'disconnected', 'connecting', 'logged_out', 'waiting_qr'],
    default: 'disconnected'
  },
  // QR code data (stored so other serverless instances can read it)
  qrCode: {
    type: String,
    default: null
  },
  // Phone number connected
  phoneNumber: {
    type: String,
    default: null
  },
  // Last connected timestamp
  connectedAt: {
    type: Date,
    default: null
  },
  // Last disconnected timestamp
  disconnectedAt: {
    type: Date,
    default: null
  },
  // Last activity (message sent, status check, etc.)
  lastActivity: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('WhatsAppSession', whatsAppSessionSchema);
