// const mongoose = require('mongoose');

// const RecordSchema = new mongoose.Schema({
//   patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
//   visitDate: { type: Date, required: true },
//   description: { type: String, required: true },
//   medication: { type: String, required: true },
// });

// module.exports = mongoose.model('Record', RecordSchema);
const mongoose = require('mongoose');

const RecordSchema = new mongoose.Schema({
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  patientName: { type: String, required: true },
  appointmentDate: { type: Date, required: false }, // latest appointment date (optional)
  issueDescription: { type: String, required: false },
  treatmentPlan: { type: String, required: false },
  ePrescription: { type: String, required: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Record', RecordSchema);

