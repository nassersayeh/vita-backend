const mongoose = require('mongoose');

const prescriptionSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic' },
  workflowStatus: { type: String, enum: ['pending_secretary', 'sent_to_pharmacy', 'completed'], default: 'pending_secretary' },
  routedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  routedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Prescriptions published to the admin-selected Vita pharmacy network.
  // Kept separate from the legacy single-pharmacy routing workflow.
  distributionChannel: { type: String, enum: ['legacy', 'vita_partner_network'], default: 'legacy', index: true },
  products: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    drugId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drug' }, // Link to central drug database
    dose: { type: String, required: true },
    name: { type: String, required: true }, // Store name for display
    quantity: { type: Number, default: 1 },
    instructions: { type: String } // How to take the medication
  }],
  medicalTests: [{
    testId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalTest' },
    name: { type: String, required: true },
    instructions: { type: String }
  }],
  
  // Prescription status and validity
  isValid: { type: Boolean, default: true },
  expiryDate: { type: Date }, // Prescription expiry
  
  // Validity mechanism
  validityType: { type: String, enum: ['time-limited', 'one-time'], default: 'time-limited' },
  validityPeriod: { type: Number, default: 7 }, // Days for time-limited, 1 for one-time
  dispensedCount: { type: Number, default: 0 }, // Track how many times dispensed for one-time prescriptions
  
  // Dispensing tracking
  dispensedAt: { type: Date },
  dispensedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Pharmacy ID
  dispensingNotes: { type: String },
  
  // Renewal system
  renewalRequests: [{
    requestDate: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    approvedDate: { type: Date },
    rejectionReason: { type: String },
    notes: { type: String }
  }],
  
  // Original prescription details
  diagnosis: { type: String },
  notes: { type: String },
  date: { type: Date, default: Date.now },
  
  // Prescription metadata
  prescriptionNumber: { type: String, unique: true }, // Auto-generated
  priority: { type: String, enum: ['normal', 'urgent'], default: 'normal' }
}, { timestamps: true });

// Auto-generate prescription number
prescriptionSchema.pre('save', function(next) {
  if (!this.prescriptionNumber) {
    this.prescriptionNumber = 'RX' + Date.now() + Math.floor(Math.random() * 1000);
  }
  next();
});

prescriptionSchema.index({ distributionChannel: 1, isValid: 1, createdAt: -1 });
prescriptionSchema.index({ doctorId: 1, distributionChannel: 1, createdAt: -1 });

module.exports = mongoose.model('EPrescription', prescriptionSchema);
