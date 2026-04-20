const mongoose = require('mongoose');

const TimeSlotSchema = new mongoose.Schema({
  start: { type: String, required: true },
  end: { type: String, required: true }
}, { _id: false });

const ScheduleSchema = new mongoose.Schema({
  day: { type: String, required: true },
  timeSlots: { type: [TimeSlotSchema], default: [] }
}, { _id: false });

const WorkplaceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  address: { type: String, required: true },
  schedule: { type: [ScheduleSchema], default: [] },
  isActive: { type: Boolean, default: true }
}, { _id: false });

const UserSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  username: { type: String, required: false, unique: true, sparse: true, maxlength: 30 },
  password: { type: String, required: true },
  email: { 
    type: String, 
    required: false, 
    unique: true, 
    sparse: true 
  }, // Updated with sparse: true
  role: { type: String, enum: ['User', 'Doctor', 'Pharmacy', 'Lab', 'Admin', 'Superadmin', 'Institution', 'Hospital', 'Employee', 'Clinic', 'Nurse', 'Accountant', 'LabTech'], required: true },
  profileImage: { type: String, default: '' },
  mobileNumber: { type: String, required: true ,unique: true},
  country: { type: String, required: function() { return this.role !== 'Employee'; } },
  city: { type: String, required: function() { return this.role !== 'Employee'; } },
  idNumber: { type: String, required: function() { return this.role !== 'Employee'; }, unique: true, sparse: true }, // Primary identifier
  address: { type: String, required: function() { return this.role !== 'Employee'; } },
  sex: { type: String },
  bloodType: { type: String, default: null },
  height: { type: Number, default: null },
  weight: { type: Number, default: null },
  
  // Marital status
  maritalStatus: { type: String, enum: ['single', 'married', 'widowed', 'divorced', ''], default: '' },
  
  // Enhanced profile fields
  allergies: [{ type: String }],
  pastIllnesses: [{ type: String }],
  chronicConditions: [{ type: String }],
  medications: [{ type: String }],
  
  // Emergency contact
  emergencyContact: { type: String },
  emergencyContactName: { type: String, default: '' },
  emergencyContactRelation: { type: String, default: '' },
  emergencyPhone: { type: String },
  
  // Insurance
  insuranceProvider: { type: String },
  insuranceNumber: { type: String },
  
  // Medical history
  hasChronicDiseases: { type: Boolean, default: false },
  chronicDiseasesText: { type: String, default: '' },
  hasSurgeries: { type: Boolean, default: false },
  surgeriesText: { type: String, default: '' },
  hasFamilyDiseases: { type: Boolean, default: false },
  familyDiseasesText: { type: String, default: '' },
  
  // Allergies detailed
  hasDrugAllergies: { type: Boolean, default: false },
  drugAllergiesText: { type: String, default: '' },
  hasFoodAllergies: { type: Boolean, default: false },
  foodAllergiesText: { type: String, default: '' },
  
  // Vital signs (initial registration)
  bloodPressure: { type: String, default: '' },
  heartRate: { type: String, default: '' },
  temperature: { type: String, default: '' },
  bloodSugar: { type: String, default: '' },
  
  // Additional info
  smoking: { type: Boolean, default: false },
  previousDiseases: { type: String, default: '' },
  disabilities: { type: String, default: '' },
  
  // Points and gamification
  points: { type: Number, default: 0 },
  totalPoints: { type: Number, default: 0 },
  lastLoginDate: { type: Date },
  spinWheelLastUsed: { type: Date },
  
  // Authentication
  resetCode: { type: String },
  resetCodeExpiration: { type: Date },
  birthdate: { type: Date, alias: 'dateOfBirth' },
  
  // Two-Factor Authentication
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorCode: { type: String },
  twoFactorCodeExpiration: { type: Date },
  
  // Phone Verification (for registration)
  isPhoneVerified: { type: Boolean, default: false },
  phoneVerificationCode: { type: String },
  phoneVerificationCodeExpiration: { type: Date },
  
  // Professional details
  generalDetails: { type: String, default: '' },
  workingSchedule: { type: [ScheduleSchema], default: [] },
  workplaces: { type: [WorkplaceSchema], default: [] }, // For doctors with multiple locations
  // Clinic management - if true, appointments for this doctor are managed by the clinic
  managedByClinic: { type: Boolean, default: false },
  clinicId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic' },
  bio: { type: String, default: '' },
  specialty: { type: String, default: '' },
  licenseNumber: { type: String }, // For doctors and pharmacies
  yearsOfExperience: { type: Number, default: 0 },
  consultationFee: { type: Number, default: 0 },
  rating: { type: Number, default: 0 }, // Provider rating, always 0 or a number
  ratingsCount: { type: Number, default: 0 }, // Number of ratings received
  
  // Technical fields
  deviceToken: { type: String },
  tokenUpdatedAt: { type: Date },
  patients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  language: { type: String, enum: ['en', 'ar'], default: 'en' },
  
  // Activation status
  activationStatus: {
    type: String,
    enum: ['pending', 'active', 'declined'],
    default: function() {
      return (this.role === 'User' || this.role === 'Nurse' || this.role === 'Accountant' || this.role === 'LabTech') ? 'active' : 'pending';
    }
  },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: { type: Date },
  
  // Subscription and trial
  isPaid: { type: Boolean, default: function() { return this.role === 'User'; } },
  trialEndDate: { type: Date, default: null },
  // Paid subscription info
  subscriptionEndDate: { type: Date, default: null },
  subscriptionPlanUnit: { type: String, enum: ['month', 'year'], default: null },
  subscriptionPlanValue: { type: Number, default: null },
  lastPaymentAmount: { type: Number, default: null },
  lastPaymentAt: { type: Date, default: null },
  
  // Saved card info (masked)
  savedCard: {
    maskedNumber: { type: String }, // e.g. **** **** **** 4242
    cardHolder: { type: String },
    expiryDate: { type: String },
    cardToken: { type: String }, // encrypted/tokenized for charging
    savedAt: { type: Date },
  },
  
  // Subscription offer
  hasAcceptedOffer: { type: Boolean, default: false },
  offerAcceptedAt: { type: Date, default: null },
  trialUsed: { type: Boolean, default: false },
  
  // Doctor WhatsApp integration
  whatsappSession: {
    isConnected: { type: Boolean, default: false },
    sessionId: { type: String },
    phoneNumber: { type: String },
    connectedAt: { type: Date }
  },
  
  // Pharmacy insurance companies
  insuranceCompanies: [{ type: String }],
  
  // Delivery addresses (for patients)
  deliveryAddresses: [{
    label: { type: String, required: true },
    city: { type: String, required: true },
    street: { type: String, required: true },
    building: { type: String },
    floor: { type: String },
    apartment: { type: String },
    phone: { type: String },
    notes: { type: String },
    isDefault: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  }],
  
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', UserSchema);
