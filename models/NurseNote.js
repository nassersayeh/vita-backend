const mongoose = require('mongoose');

const NurseNoteSchema = new mongoose.Schema({
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  nurse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    default: null
  },
  // Vitals taken by nurse
  vitals: {
    bloodPressure: { type: String },
    heartRate: { type: String },
    temperature: { type: String },
    weight: { type: String },
    height: { type: String },
    oxygenSaturation: { type: String },
    respiratoryRate: { type: String },
    bloodSugar: { type: String },
  },
  // Nurse observations
  chiefComplaint: { type: String },
  observations: { type: String },
  nursingNotes: { type: String },
  instructions: { type: String },
  // Allergies noted
  allergiesNoted: [{ type: String }],
  // Current medications noted
  currentMedications: [{ type: String }],
  // Priority/urgency
  priority: {
    type: String,
    enum: ['normal', 'urgent', 'critical'],
    default: 'normal'
  },
  // Which doctor the patient is being sent to
  assignedDoctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Status
  status: {
    type: String,
    enum: ['draft', 'completed', 'sent_to_doctor'],
    default: 'draft'
  },
  // Attachments
  attachments: [{ type: String }],
}, {
  timestamps: true
});

// Indexes
NurseNoteSchema.index({ patient: 1, createdAt: -1 });
NurseNoteSchema.index({ nurse: 1, createdAt: -1 });
NurseNoteSchema.index({ clinicId: 1, createdAt: -1 });

module.exports = mongoose.model('NurseNote', NurseNoteSchema);
