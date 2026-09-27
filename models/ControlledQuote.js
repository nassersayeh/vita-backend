const mongoose = require('mongoose');
const schema = require('./PharmacyPrescriptionQuote').schema.clone();
schema.path('prescription').options.ref = 'ControlledPrescription';
module.exports = mongoose.model('ControlledQuote', schema);
