const mongoose = require('mongoose');

const SupplierSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  contactPerson: {
    type: String,
    trim: true,
    maxlength: 100
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  phone: {
    type: String,
    trim: true,
    maxlength: 20
  },
  address: {
    type: String,
    trim: true,
    maxlength: 200
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  products: [{
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    category: {
      type: String,
      trim: true,
      maxlength: 50
    },
    price: {
      type: Number,
      min: 0
    }
  }], // What products/services they provide
  notes: {
    type: String,
    trim: true,
    maxlength: 300
  }
}, {
  timestamps: true
});

// Indexes for better performance
SupplierSchema.index({ name: 1 });
SupplierSchema.index({ createdBy: 1 });
SupplierSchema.index({ isActive: 1 });

module.exports = mongoose.model('Supplier', SupplierSchema);