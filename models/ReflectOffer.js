const mongoose = require('mongoose');

const ReflectOfferSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  fullName: { type: String, required: true },
  idNumber: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  healthInsurance: { type: Boolean, required: true },
  insuranceCompany: { type: String, default: '' }, // New field: required when healthInsurance is true.
  status: { 
    type: String, 
    enum: ['pending', 'in review', 'accepted', 'declined'], 
    default: 'pending' 
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('ReflectOffer', ReflectOfferSchema);
