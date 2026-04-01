const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  // The clinic this conversation belongs to (restricts messaging to clinic members only)
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    required: true,
    index: true
  },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, maxlength: 5000 },
  type: { type: String, enum: ['text', 'image', 'file'], default: 'text' },
  fileUrl: { type: String, default: null },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date, default: null },
}, { timestamps: true });

// Indexes for performance
MessageSchema.index({ clinicId: 1, senderId: 1, receiverId: 1, createdAt: -1 });
MessageSchema.index({ clinicId: 1, receiverId: 1, isRead: 1 });

module.exports = mongoose.model('Message', MessageSchema);
