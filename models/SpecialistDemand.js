const mongoose = require('mongoose');

const SpecialistDemandSchema = new mongoose.Schema({
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  specialty: { type: String, required: true, index: true },
  requestedCity: { type: String, default: '', index: true },
  symptoms: { type: String, default: '' },
  status: {
    type: String,
    enum: ['pending', 'contacted', 'resolved'],
    default: 'pending',
    index: true,
  },
  requestCount: { type: Number, default: 0 },
  firstRequestedAt: { type: Date, default: Date.now },
  lastRequestedAt: { type: Date, default: Date.now },
  contactedAt: { type: Date },
}, { timestamps: true });

SpecialistDemandSchema.index(
  { patientId: 1, specialty: 1, requestedCity: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

module.exports = mongoose.model('SpecialistDemand', SpecialistDemandSchema);
