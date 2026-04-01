const mongoose = require('mongoose');

const PharmacyInventorySchema = new mongoose.Schema({
  pharmacyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  drugId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Drug', 
    required: true 
  },
  // Drug details (denormalized for quick access)
  drugName: { type: String, required: true },
  drugGenericName: { type: String },
  
  // Pharmacy-specific pricing and inventory
  quantity: { type: Number, required: true, min: 0 }, // Stock amount
  price: { type: Number, required: true, min: 0 }, // Pharmacy's selling price
  costPrice: { type: Number }, // Cost price for the pharmacy (optional)
  currency: { type: String, default: 'ILS' }, // Currency code
  
  // Availability status
  isAvailable: { type: Boolean, default: true }, // Can be ordered
  minimumStock: { type: Number, default: 5 }, // Reorder level
  maximumStock: { type: Number }, // Maximum stock level
  
  // Tracking
  lastRestockDate: { type: Date },
  lastSoldDate: { type: Date },
  soldCount: { type: Number, default: 0 }, // Total sold through the app
  
  // Notes
  notes: { type: String }, // e.g., "Low stock", "On order", etc.
  
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Compound index to ensure unique drug per pharmacy
PharmacyInventorySchema.index({ pharmacyId: 1, drugId: 1 }, { unique: true });
PharmacyInventorySchema.index({ pharmacyId: 1 });
PharmacyInventorySchema.index({ drugId: 1 });

module.exports = mongoose.model('PharmacyInventory', PharmacyInventorySchema);
