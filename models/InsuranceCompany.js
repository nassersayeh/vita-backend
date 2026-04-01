const mongoose = require('mongoose');

const InsuranceCompanySchema = new mongoose.Schema({
  name: { type: String, required: true },
  nameAr: { type: String, default: '' },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  address: { type: String, default: '' },
  city: { type: String, default: '' },
  country: { type: String, default: '' },
  licenseNumber: { type: String, default: '' },
  website: { type: String, default: '' },
  logo: { type: String, default: '' },
  contactPerson: { type: String, default: '' },
  contactPersonPhone: { type: String, default: '' },
  contactPersonEmail: { type: String, default: '' },
  
  // Account credentials
  username: { type: String, unique: true, sparse: true },
  password: { type: String },
  
  // Coverage details
  coveragePercentage: { type: Number, default: 80 }, // Default 80% coverage
  maxCoverageAmount: { type: Number, default: 0 }, // 0 means unlimited
  
  // Status
  status: { 
    type: String, 
    enum: ['active', 'inactive', 'pending'], 
    default: 'active' 
  },
  
  // Notes
  notes: { type: String, default: '' },
  
  // Financial
  totalClaims: { type: Number, default: 0 },
  totalPaid: { type: Number, default: 0 },
  pendingAmount: { type: Number, default: 0 },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
});

// Index for searching
InsuranceCompanySchema.index({ name: 'text', nameAr: 'text', email: 'text' });

module.exports = mongoose.model('InsuranceCompany', InsuranceCompanySchema);
