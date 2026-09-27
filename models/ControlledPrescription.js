const mongoose = require('mongoose');
// Separate collection: legacy prescription endpoints cannot read, renew or alter controlled prescriptions.
const schema = require('./EPrescription').schema.clone();
schema.path('patientId').required(false);
schema.path('prescriptionNumber').options.immutable = true;
schema.add({
  controlled: { type: Boolean, default: true, immutable: true },
  serial: { type: String, required: true, immutable: true },
  allocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'ControlledAllocation', required: true, immutable: true },
  integrityVersion: Number,
  integritySeal: { type: String, select: false },
  issuedAt: Date,
  stoppedAt: Date,
  stoppedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'OversightAccount' },
  stoppedByRole: String,
  stoppedByName: String,
  stopReason: String,
  issueRequestId: String,
  patientSnapshot: mongoose.Schema.Types.Mixed,
  doctorSnapshot: mongoose.Schema.Types.Mixed,
  pharmacySnapshot: mongoose.Schema.Types.Mixed,
  audit: [{ action: String, actor: String, at: { type: Date, default: Date.now }, details: String }],
});
schema.path('products').schema.add({ allowedPills: { type: Number, min: 1 }, frequency: String });
schema.index({ serial: 1 }, { unique: true });
schema.index({ doctorId: 1, issueRequestId: 1 }, { unique: true, partialFilterExpression: { issueRequestId: { $type: 'string' } } });
schema.index({ doctorId: 1, issuedAt: 1 });
schema.index({ dispensedBy: 1, dispensedAt: -1 });
module.exports = mongoose.model('ControlledPrescription', schema);
