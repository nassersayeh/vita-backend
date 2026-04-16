const mongoose = require('mongoose');

const DoctorClaimSchema = new mongoose.Schema({
  // Who submitted the claim
  submittedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  submittedByRole: {
    type: String,
    enum: ['Doctor', 'Accountant'],
    required: true
  },
  // If submitted by doctor, store doctor info; if by accountant, store clinic info
  doctorId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User'
  },
  clinicId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Clinic'
  },
  // Display name for the claim (doctor name or clinic name)
  displayName: { type: String, required: true },
  
  insuranceCompanyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'InsuranceCompany', 
    required: true 
  },
  
  // Patient info
  patientId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User'
  },
  patientName: { type: String, default: '' },
  
  // Related appointments
  appointmentIds: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Appointment' 
  }],
  
  // Claim details
  claimNumber: { type: String, unique: true },
  claimAmount: { type: Number, required: true },
  approvedAmount: { type: Number, default: 0 },
  
  // Status tracking
  status: { 
    type: String, 
    enum: ['pending', 'submitted', 'under_review', 'approved', 'partially_approved', 'rejected', 'paid'], 
    default: 'pending' 
  },
  
  // Additional information
  description: { type: String, default: '' },
  notes: { type: String, default: '' },
  rejectionReason: { type: String, default: '' },
  
  // Service details
  serviceType: { type: String, default: 'consultation' }, // consultation, procedure, surgery, etc.
  serviceDate: { type: Date },
  
  // Dates
  submittedAt: { type: Date },
  reviewedAt: { type: Date },
  approvedAt: { type: Date },
  paidAt: { type: Date },
  
  // Audit trail
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
});

// Generate claim number before saving
DoctorClaimSchema.pre('save', async function(next) {
  if (!this.claimNumber) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    this.claimNumber = `DCL-${year}${month}-${random}`;
  }
  next();
});

// Indexes
DoctorClaimSchema.index({ claimNumber: 'text' });
DoctorClaimSchema.index({ doctorId: 1, status: 1 });
DoctorClaimSchema.index({ clinicId: 1, status: 1 });
DoctorClaimSchema.index({ insuranceCompanyId: 1, status: 1 });
DoctorClaimSchema.index({ submittedBy: 1 });

module.exports = mongoose.model('DoctorClaim', DoctorClaimSchema);
