const mongoose = require('mongoose');

const ImageRequestSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  imageType: { type: String, required: true }, // e.g., 'X-Ray', 'MRI', 'CT Scan', 'Ultrasound'
  bodyPart: { type: String }, // e.g., 'Chest', 'Head', 'Knee'
  status: { type: String, enum: ['pending', 'in_progress', 'completed', 'cancelled'], default: 'pending' },
  requestDate: { type: Date, default: Date.now },
  scheduledDate: { type: Date },
  completedDate: { type: Date },
  notes: { type: String },
  images: [{
    filename: { type: String },
    filePath: { type: String },
    fileUrl: { type: String },
    uploadedAt: { type: Date, default: Date.now },
    notes: { type: String }
  }],
  radiologistNotes: { type: String },
  findings: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('ImageRequest', ImageRequestSchema);
