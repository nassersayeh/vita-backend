const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  drugId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drug' }, // Link to central drug database
  name: { type: String, required: true },
  price: { type: Number, required: true, min: 0 },
  amount: { type: Number, required: true, min: 0, default: 0 }, // Stock quantity
  description: { type: String, default: '' },
  image: { type: String, default: '' },
  category: { type: String, default: 'عام' },
  
  // Enhanced product fields
  barcode: { type: String, unique: true, sparse: true },
  batchNumber: { type: String },
  expiryDate: { type: Date },
  manufacturingDate: { type: Date },
  manufacturer: { type: String },
  
  // Pricing and inventory
  costPrice: { type: Number, min: 0 }, // Purchase price
  sellingPrice: { type: Number, min: 0 }, // Retail price
  minStockLevel: { type: Number, default: 10 }, // Minimum stock alert level
  
  // Product status
  isActive: { type: Boolean, default: true },
  isOnSale: { type: Boolean, default: false },
  salePrice: { type: Number, min: 0 },
  
  // Tracking
  totalSold: { type: Number, default: 0 },
  lastSoldDate: { type: Date },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

productSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Index for efficient searching
productSchema.index({ name: 'text', description: 'text' });
productSchema.index({ pharmacyId: 1, isActive: 1 });

module.exports = mongoose.model('Product', productSchema);
