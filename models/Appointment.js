const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  appointmentDateTime: { type: Date, required: true },
  workplaceName: { type: String, default: '' }, // Workplace name for appointment
  workplaceAddress: { type: String, default: '' }, // Workplace address for appointment
  reason: { type: String, required: true }, // Added reason field
  notes: { type: String },
  durationMinutes: { type: Number, enum: [30, 60], default: 30 }, // Appointment duration: 30 or 60 minutes
  urgency: { type: String, enum: ['normal', 'urgent'], default: 'normal' }, // Added urgency field
  status: { type: String, enum: ['pending', 'confirmed', 'completed', 'cancelled'], default: 'pending' },
  isPaid: { type: Boolean, default: false }, // Payment status
  paymentAmount: { type: Number, default: 0 }, // Amount paid for this appointment
  paidAt: { type: Date }, // When the payment was marked
  autoMarkedAsPaid: { type: Boolean, default: false }, // Whether it was auto-marked after 24h
  // Debt tracking
  appointmentFee: { type: Number, default: 0 }, // Expected fee for this appointment
  debt: { type: Number, default: 0 }, // Amount still owed (appointmentFee - paymentAmount)
  debtStatus: { type: String, enum: ['none', 'partial', 'full'], default: 'none' }, // none=fully paid, partial=partly paid, full=unpaid
  numberOfUniquePatients: { type: Number, default: 1 }, // For monthly statistics
  // Reminder tracking
  reminderDaySent: { type: Boolean, default: false }, // Reminder sent on the day of appointment
  reminder30MinSent: { type: Boolean, default: false }, // Reminder sent 30 minutes before appointment
  // Rating fields
  rating: { type: Number, default: null }, // Patient's rating for this appointment
  isRated: { type: Boolean, default: false }, // Whether the patient has rated this appointment
  // Blocked slot (for cancelled appointments where doctor wants to keep the time blocked)
  blockedSlot: { type: Boolean, default: false }, // If true, the time slot remains unavailable even when cancelled
  // Track who created the appointment (e.g. accountant)
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Clinic management - if set, this appointment is managed by the clinic, not the doctor
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic' },
  // Doctor-set fee from medical record (so accountant knows what to charge)
  doctorFee: { type: Number, default: 0 },
  // Clinic examination fee (كشفية) - set by accountant when creating appointment
  clinicFee: { type: Number, default: 0 },
  // Financial split between clinic and doctor
  clinicPercentage: { type: Number, default: 0 }, // The clinic's percentage at time of completion
  clinicShare: { type: Number, default: 0 }, // Amount going to clinic
  doctorShare: { type: Number, default: 0 }, // Amount going to doctor
  // Whether doctor has been paid his share
  doctorPaid: { type: Boolean, default: false },
  doctorPaidAt: { type: Date },
  doctorPaidAmount: { type: Number, default: 0 },
}, { timestamps: true });

// Index to prevent double booking (same doctor, same time, same workplace)
appointmentSchema.index(
  { doctorId: 1, appointmentDateTime: 1, workplaceName: 1 },
  { 
    unique: true,
    partialFilterExpression: { status: { $ne: 'cancelled' } }
  }
);

module.exports = mongoose.model('Appointment', appointmentSchema);