const mongoose = require('mongoose');

const InsuranceClaimSchema = new mongoose.Schema({
  pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pharmacyName: { type: String, default: '' },
  insuranceCompanyId: { type: mongoose.Schema.Types.ObjectId, ref: 'InsuranceCompany' },
  insuranceCompany: { type: String, required: true },
  claimMonth: { type: String, default: '' },
  claimYear: { type: String, default: '' },
  startDate: { type: Date },
  endDate: { type: Date },
  claimsCount: { type: Number, required: true },
  claimsValue: { type: Number, required: true },
  notes: { type: String, default: '' },
  attachmentData: { type: String, default: '' },
  attachmentName: { type: String, default: '' },
  attachmentMime: { type: String, default: '' },
  status: { 
    type: String, 
    enum: ['draft', 'pending', 'under_review', 'rejected', 'paid'], 
    default: 'draft' 
  },
  // Payment for claim service (5 ILS per claim)
  serviceFee: { type: Number, default: 10 },
  servicePaymentStatus: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
  servicePaymentRef: { type: String, default: '' },
  servicePaymentDate: { type: Date },
  // Rejection details
  rejectionReason: { type: String, default: '' },
  // Payment details
  paymentMethod: { type: String, default: '' },
  paymentReference: { type: String, default: '' },
  paidAmount: { type: Number, default: 0 },
  paidAt: { type: Date },
  // Review tracking
  reviewedBy: { type: String, default: '' },
  reviewedAt: { type: Date },
  statusHistory: [{
    status: String,
    changedBy: String,
    reason: String,
    timestamp: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now },
});

InsuranceClaimSchema.index({ pharmacyId: 1, createdAt: -1 });
InsuranceClaimSchema.index({ insuranceCompany: 1, status: 1 });

module.exports = mongoose.model('InsuranceClaim', InsuranceClaimSchema);
