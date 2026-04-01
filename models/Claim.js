const mongoose = require('mongoose');

const ClaimSchema = new mongoose.Schema({
  pharmacyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  customerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'PharmacyCustomer', 
    required: true 
  },
  insuranceCompanyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'InsuranceCompany', 
    required: true 
  },
  // Support both single order (legacy) and multiple orders
  orderId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Order'
  },
  orderIds: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Order' 
  }],
  
  // Claim details
  claimNumber: { type: String, unique: true },
  claimAmount: { type: Number, required: true },
  approvedAmount: { type: Number, default: 0 },
  patientPortion: { type: Number, default: 0 },
  
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
  
  // Dates
  submittedAt: { type: Date },
  reviewedAt: { type: Date },
  approvedAt: { type: Date },
  paidAt: { type: Date },
  
  // Audit trail
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
});

// Generate claim number before saving
ClaimSchema.pre('save', async function(next) {
  if (!this.claimNumber) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    this.claimNumber = `CLM-${year}${month}-${random}`;
  }
  next();
});

// Index for searching
ClaimSchema.index({ claimNumber: 'text' });
ClaimSchema.index({ pharmacyId: 1, status: 1 });
ClaimSchema.index({ insuranceCompanyId: 1, status: 1 });

module.exports = mongoose.model('Claim', ClaimSchema);
