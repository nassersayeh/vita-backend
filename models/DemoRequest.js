const mongoose = require('mongoose');

const demoRequestSchema = new mongoose.Schema({
  organization: { type: String, required: true, trim: true },
  contact: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, trim: true, default: '' },
  country: { type: String, required: true, trim: true },
  type: { type: String, required: true, trim: true },
  size: { type: String, trim: true, default: '' },
  time: { type: String, trim: true, default: '' },
  message: { type: String, trim: true, default: '' },
  source: { type: String, trim: true, default: 'request_demo_page' },
  pagePath: { type: String, trim: true, default: '' },
  query: { type: String, trim: true, default: '' },
  language: { type: String, enum: ['ar', 'en'], default: 'en' },
  submittedAt: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ['new', 'contacted', 'scheduled', 'closed'],
    default: 'new',
  },
  notes: { type: String, trim: true, default: '' },
  handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  handledAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('DemoRequest', demoRequestSchema);
