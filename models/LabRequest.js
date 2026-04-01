const mongoose = require('mongoose');

const LabRequestSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  labId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  testIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MedicalTest' }],
  status: { type: String, enum: ['pending', 'in_progress', 'in-progress', 'completed', 'cancelled'], default: 'pending' },
  requestDate: { type: Date, default: Date.now },
  scheduledDate: { type: Date },
  completedDate: { type: Date },
  notes: { type: String },
  results: [{
    testId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalTest' },
    result: { type: String },
    normalRange: { type: String },
    unit: { type: String },
    isNormal: { type: Boolean },
    notes: { type: String },
    attachments: [{ type: String }] // file paths for images/documents
  }],
  totalCost: { type: Number, default: 0 },
  // Approval flow - for clinic-managed doctors, accountant must approve before lab sees it
  approvalStatus: {
    type: String,
    enum: ['pending_approval', 'approved', 'rejected'],
    default: 'approved'
  },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: { type: Date },
  rejectionReason: { type: String },
  // Payment tracking
  isPaid: { type: Boolean, default: false },
  paidAmount: { type: Number, default: 0 },
  paidAt: { type: Date },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Who requested (for accountant-initiated requests)
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Clinic reference
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic' },
  // Test name for simple requests (non-testIds based)
  testName: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('LabRequest', LabRequestSchema);
