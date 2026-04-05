const mongoose = require('mongoose');

const financialSchema = new mongoose.Schema({
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  totalEarnings: { type: Number, default: 0 },
  totalExpenses: { type: Number, default: 0 },
  transactions: [
    {
      amount: { type: Number, required: true },
      description: { type: String, default: 'دخل يدوي' },
      date: { type: Date, default: Date.now },
      patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
      orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
      paymentMethod: { type: String, enum: ['Cash', 'Card', 'Visa', 'Insurance', 'BankTransfer'], required: true },
      // Discount applied to this payment
      discount: { type: Number, default: 0 },
      discountPercent: { type: Number, default: 0 },
      totalDebtBeforeDiscount: { type: Number, default: 0 },
      // Audit: who last edited this transaction
      lastEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      lastEditedAt: { type: Date, default: null },
    },
  ],
  expenses: [
    {
      amount: { type: Number, required: true },
      description: { type: String, default: 'مصروف يدوي' },
      date: { type: Date, default: Date.now },
      category: {
        type: String,
        enum: ['General', 'Salary', 'Equipment', 'Utilities', 'Other', 'Inventory', 'Supplier Payments'],
        default: 'General',
      },
      employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // For salary expenses
      supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' }, // For supplier payments
      selectedProducts: [{ // For supplier payments - which products were paid for
        productId: { type: String }, // Reference to product in supplier
        name: { type: String },
        quantity: { type: Number, default: 1 },
        unitPrice: { type: Number },
      }],
    },
  ],
  debts: [
    {
      patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Doctor who created the debt (for revenue split)
      orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
      amount: { type: Number, required: true },
      originalAmount: { type: Number }, // Original amount before any payment (preserved when debt is paid)
      description: { type: String, default: 'دين يدوي' },
      date: { type: Date, default: Date.now },
      status: { type: String, enum: ['pending', 'paid'], default: 'pending' },
      paidAt: { type: Date }, // When the debt was paid
    },
  ],
});

module.exports = mongoose.model('Financial', financialSchema);