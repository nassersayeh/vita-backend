const mongoose = require('mongoose');

const PharmacySupplierSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    maxlength: 100
  },
  description: {
    type: String,
    required: true,
    maxlength: 500
  },
  contactPerson: {
    type: String,
    maxlength: 100
  },
  email: {
    type: String,
    lowercase: true
  },
  phone: {
    type: String,
    maxlength: 20
  },
  address: {
    type: String,
    maxlength: 200
  },
  // The pharmacy that created this supplier
  pharmacyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  products: [{
    name: { type: String, required: true },
    category: { type: String },
    price: { type: Number }
  }],
  notes: {
    type: String,
    maxlength: 300
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
PharmacySupplierSchema.index({ pharmacyId: 1 });
PharmacySupplierSchema.index({ pharmacyId: 1, isActive: 1 });

module.exports = mongoose.model('PharmacySupplier', PharmacySupplierSchema);
