const mongoose = require('mongoose');

const ClinicDoctorSchema = new mongoose.Schema({
  // Reference to the doctor user account
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Status of the doctor in the clinic
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending'],
    default: 'active'
  },
  
  // When the doctor was added to the clinic
  addedAt: {
    type: Date,
    default: Date.now
  },
  
  // Notes about this doctor
  notes: {
    type: String,
    default: ''
  },
  
  // Clinic percentage from this doctor's consultations (0-100)
  clinicPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  }
}, { _id: true });

const ClinicStaffSchema = new mongoose.Schema({
  // Reference to the staff user account
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Staff role
  role: {
    type: String,
    enum: ['Nurse', 'Accountant', 'LabTech'],
    required: true
  },
  
  // Status
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending'],
    default: 'active'
  },
  
  // When the staff was added
  addedAt: {
    type: Date,
    default: Date.now
  },
  
  // Notes
  notes: {
    type: String,
    default: ''
  }
}, { _id: true });

const ClinicSchema = new mongoose.Schema({
  // Reference to the clinic owner (User with role 'Clinic')
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  
  // Clinic name
  name: {
    type: String,
    required: true
  },
  
  // Clinic description
  description: {
    type: String,
    default: ''
  },
  
  // Maximum number of doctors allowed (default 10)
  maxDoctors: {
    type: Number,
    default: 10,
    max: 10
  },
  
  // Doctors/employees managed by this clinic
  doctors: {
    type: [ClinicDoctorSchema],
    default: [],
    validate: {
      validator: function(arr) {
        return arr.length <= this.maxDoctors;
      },
      message: 'Cannot exceed maximum number of doctors allowed'
    }
  },
  
  // Staff members (nurses, accountants, lab techs)
  staff: {
    type: [ClinicStaffSchema],
    default: []
  },
  
  // Clinic settings
  settings: {
    allowDoctorFinancialView: { type: Boolean, default: true },
    allowDoctorPatientView: { type: Boolean, default: true },
    allowDoctorScheduleEdit: { type: Boolean, default: true },
    autoApproveAppointments: { type: Boolean, default: false },
    labPercentage: { type: Number, default: 0, min: 0, max: 100 }
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for performance
ClinicSchema.index({ 'doctors.doctorId': 1 });
ClinicSchema.index({ 'staff.userId': 1 });

// Virtual to get doctor count
ClinicSchema.virtual('doctorCount').get(function() {
  return this.doctors.filter(d => d.status === 'active').length;
});

// Method to add a doctor to the clinic
ClinicSchema.methods.addDoctor = async function(doctorId, notes = '') {
  const activeDoctors = this.doctors.filter(d => d.status === 'active');
  if (activeDoctors.length >= this.maxDoctors) {
    throw new Error(`Cannot add more than ${this.maxDoctors} doctors`);
  }
  
  // Check if doctor already exists
  const existingDoctor = this.doctors.find(d => d.doctorId.toString() === doctorId.toString());
  if (existingDoctor) {
    if (existingDoctor.status === 'inactive') {
      existingDoctor.status = 'active';
      existingDoctor.addedAt = new Date();
      existingDoctor.notes = notes;
    } else {
      throw new Error('Doctor is already in this clinic');
    }
  } else {
    this.doctors.push({ doctorId, notes, status: 'active' });
  }
  
  return this.save();
};

// Method to remove a doctor from the clinic
ClinicSchema.methods.removeDoctor = async function(doctorId) {
  const doctorEntry = this.doctors.find(d => d.doctorId.toString() === doctorId.toString());
  if (!doctorEntry) {
    throw new Error('Doctor not found in this clinic');
  }
  
  doctorEntry.status = 'inactive';
  return this.save();
};

module.exports = mongoose.model('Clinic', ClinicSchema);
