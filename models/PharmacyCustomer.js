const mongoose = require('mongoose');

const PharmacyCustomerSchema = new mongoose.Schema({
  pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  notes: { type: String, default: '' },
  isOnline: { type: Boolean, default: false }, // true if added from online Vita order
  insuranceCompanies: [{ type: String }], // list of insurance company names used by this customer
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PharmacyCustomer', PharmacyCustomerSchema);
