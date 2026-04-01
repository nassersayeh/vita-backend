const mongoose = require('mongoose');

const pharmacyFinancialSchema = new mongoose.Schema({
  pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // Financial summary
  totalRevenue: { type: Number, default: 0 }, // Total revenue from orders
  totalExpenses: { type: Number, default: 0 }, // Total expenses (purchases, operations)
  netProfit: { type: Number, default: 0 }, // Revenue - Expenses
  
  // Monthly tracking
  currentMonth: { type: Date, default: () => new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
  monthlyRevenue: { type: Number, default: 0 },
  monthlyExpenses: { type: Number, default: 0 },
  monthlyProfit: { type: Number, default: 0 },
  
  // Transaction history
  transactions: [{
    transactionId: mongoose.Schema.Types.ObjectId,
    type: { type: String, enum: ['income', 'expense'], required: true }, // income or expense
    category: { type: String, enum: ['order', 'purchase', 'operational', 'refund', 'adjustment', 'debt-payment'], default: 'order' },
    amount: { type: Number, required: true },
    description: { type: String },
    relatedId: mongoose.Schema.Types.ObjectId, // Reference to Order, Purchase, etc.
    relatedModel: String, // 'Order', 'Purchase', etc.
    reference: String, // Reference number or invoice
    paymentMethod: String, // Cash, Card, Bank Transfer, etc.
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' },
    date: { type: Date, default: Date.now },
    notes: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } // Admin or staff who logged it
  }],
  
  // Balances
  accountBalance: { type: Number, default: 0 }, // Current account balance
  
  // Debts tracking
  debts: [{
    id: { type: String, required: true },
    type: { type: String, default: 'debt' },
    amount: { type: Number, required: true },
    description: { type: String, required: true },
    patientName: { type: String, required: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    patientPhone: { type: String },
    date: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
    paidAt: Date,
    createdAt: { type: Date, default: Date.now }
  }],
  totalDebts: { type: Number, default: 0 },
  
  // Timestamps
  lastUpdated: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Index for efficient querying
pharmacyFinancialSchema.index({ pharmacyId: 1 });
pharmacyFinancialSchema.index({ 'transactions.date': -1 });
pharmacyFinancialSchema.index({ currentMonth: 1 });

// Calculate net profit before saving
pharmacyFinancialSchema.pre('save', function(next) {
  this.netProfit = this.totalRevenue - this.totalExpenses;
  this.monthlyProfit = this.monthlyRevenue - this.monthlyExpenses;
  this.lastUpdated = new Date();
  next();
});

module.exports = mongoose.model('PharmacyFinancial', pharmacyFinancialSchema);
