const mongoose = require('mongoose');

const PotentialClientStatusSchema = new mongoose.Schema({
  source: {
    type: String,
    enum: ['smarthealth', 'ppa'],
    required: true,
  },
  sourceKey: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['none', 'contacted', 'subscribed', 'trial', 'rejected'],
    default: 'none',
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true });

PotentialClientStatusSchema.index({ source: 1, sourceKey: 1 }, { unique: true });

module.exports = mongoose.model('PotentialClientStatus', PotentialClientStatusSchema);
