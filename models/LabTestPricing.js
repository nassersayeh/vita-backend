const mongoose = require('mongoose');

const LabTestPriceSchema = new mongoose.Schema({
  testId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MedicalTest',
    required: true
  },
  price: {
    type: Number,
    required: true,
    default: 0
  },
  isAvailable: {
    type: Boolean,
    default: true
  }
}, { _id: false });

const LabTestPricingSchema = new mongoose.Schema({
  // The lab or labtech user who owns this pricing list
  labId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  // Array of tests with individual prices
  tests: [LabTestPriceSchema],
  // Currency (default ILS - Israeli Shekel)
  currency: {
    type: String,
    default: 'ILS'
  },
  // Source of pricing (e.g., "تسعيرة نقابة 2018")
  pricingSource: {
    type: String,
    default: ''
  },
  // Last time pricing was updated
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

module.exports = mongoose.model('LabTestPricing', LabTestPricingSchema);
