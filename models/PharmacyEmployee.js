const mongoose = require('mongoose');

// Pharmacy-specific permissions schema
const PharmacyPermissionSchema = new mongoose.Schema({
  // Inventory Management
  canViewInventory: { type: Boolean, default: false },
  canManageInventory: { type: Boolean, default: false },
  canAddProducts: { type: Boolean, default: false },
  canEditProducts: { type: Boolean, default: false },
  canDeleteProducts: { type: Boolean, default: false },
  
  // Orders
  canViewOrders: { type: Boolean, default: false },
  canProcessOrders: { type: Boolean, default: false },
  canDispenseOrders: { type: Boolean, default: false },
  canCancelOrders: { type: Boolean, default: false },
  
  // Prescriptions
  canViewPrescriptions: { type: Boolean, default: false },
  canFillPrescriptions: { type: Boolean, default: false },
  
  // Financial
  canViewFinancials: { type: Boolean, default: false },
  canManageTransactions: { type: Boolean, default: false },
  canManageExpenses: { type: Boolean, default: false },
  canViewReports: { type: Boolean, default: false },
  
  // Suppliers
  canViewSuppliers: { type: Boolean, default: false },
  canManageSuppliers: { type: Boolean, default: false },
  
  // POS
  canUsePOS: { type: Boolean, default: false },
  canApplyDiscounts: { type: Boolean, default: false },
  
  // Settings
  canEditPharmacySettings: { type: Boolean, default: false },
}, { _id: false });

const PharmacyEmployeeSchema = new mongoose.Schema({
  // The pharmacy that owns this employee
  pharmacyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // The employee's user account
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Position/Role within the pharmacy
  position: {
    type: String,
    enum: ['Pharmacist Assistant', 'Cashier', 'Inventory Manager', 'Delivery', 'Other'],
    default: 'Pharmacist Assistant'
  },
  
  // Employment details
  hireDate: {
    type: Date,
    default: Date.now
  },
  
  salary: {
    amount: { type: Number },
    currency: { type: String, default: 'ILS' },
    frequency: {
      type: String,
      enum: ['hourly', 'daily', 'weekly', 'monthly'],
      default: 'monthly'
    }
  },
  
  workingHours: {
    start: { type: String, default: '09:00' },
    end: { type: String, default: '17:00' },
    days: [{
      type: String,
      enum: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    }]
  },
  
  // Permissions
  permissions: {
    type: PharmacyPermissionSchema,
    default: () => ({})
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  
  notes: {
    type: String
  },
  
  emergencyContact: {
    name: { type: String },
    phone: { type: String },
    relationship: { type: String }
  }
}, {
  timestamps: true
});

// Compound index for efficient queries
PharmacyEmployeeSchema.index({ pharmacyId: 1, userId: 1 }, { unique: true });
PharmacyEmployeeSchema.index({ pharmacyId: 1, isActive: 1 });

module.exports = mongoose.model('PharmacyEmployee', PharmacyEmployeeSchema);
