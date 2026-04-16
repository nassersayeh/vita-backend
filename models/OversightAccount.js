const mongoose = require('mongoose');

const OversightAccountSchema = new mongoose.Schema({
  name: { type: String, required: true },
  nameAr: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['ministry_of_health', 'medical_syndicate', 'pharmacy_syndicate'], 
    required: true,
    unique: true
  },
  email: { type: String, required: true, unique: true },
  phone: { type: String, default: '' },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  
  // Status
  status: { 
    type: String, 
    enum: ['active', 'inactive'], 
    default: 'active' 
  },
  
  // Permissions - what they can view
  canViewDoctorClaims: { type: Boolean, default: true },
  canViewPharmacyClaims: { type: Boolean, default: true },
  canViewFinancials: { type: Boolean, default: true },
  
  notes: { type: String, default: '' },
  
  lastLoginAt: { type: Date },
}, {
  timestamps: true
});

OversightAccountSchema.index({ type: 1 });
OversightAccountSchema.index({ username: 1 });

module.exports = mongoose.model('OversightAccount', OversightAccountSchema);
