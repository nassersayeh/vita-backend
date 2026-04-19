const mongoose = require('mongoose');

const InsuranceClaimSchema = new mongoose.Schema({
  pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pharmacyName: { type: String, default: '' },
  insuranceCompany: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  claimsCount: { type: Number, required: true },
  claimsValue: { type: Number, required: true },
  notes: { type: String, default: '' },
  attachmentData: { type: String, default: '' },
  attachmentName: { type: String, default: '' },
  attachmentMime: { type: String, default: '' },
  status: { 
    type: String, 
    enum: ['pending', 'under_review', 'rejected', 'paid'], 
    default: 'pending' 
  },
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
