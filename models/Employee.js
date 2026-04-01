const mongoose = require('mongoose');

const PermissionSchema = new mongoose.Schema({
  // Patient Management
  canViewPatients: { type: Boolean, default: false },
  canAddPatients: { type: Boolean, default: false },
  canEditPatients: { type: Boolean, default: false },
  canDeletePatients: { type: Boolean, default: false },

  // Appointments
  canViewAppointments: { type: Boolean, default: false },
  canCreateAppointments: { type: Boolean, default: false },
  canEditAppointments: { type: Boolean, default: false },
  canCancelAppointments: { type: Boolean, default: false },

  // Prescriptions
  canViewPrescriptions: { type: Boolean, default: false },
  canCreatePrescriptions: { type: Boolean, default: false },
  canEditPrescriptions: { type: Boolean, default: false },
  canDeletePrescriptions: { type: Boolean, default: false },

  // Medical Records
  canViewMedicalRecords: { type: Boolean, default: false },
  canCreateMedicalRecords: { type: Boolean, default: false },
  canEditMedicalRecords: { type: Boolean, default: false },

  // Financial
  canViewFinancials: { type: Boolean, default: false },
  canManageIncome: { type: Boolean, default: false },
  canManageExpenses: { type: Boolean, default: false },
  canViewReports: { type: Boolean, default: false },

  // Lab Requests
  canViewLabRequests: { type: Boolean, default: false },
  canCreateLabRequests: { type: Boolean, default: false },

  // Pharmacy Orders
  canViewOrders: { type: Boolean, default: false },
  canCreateOrders: { type: Boolean, default: false },

  // Schedule Management
  canViewSchedule: { type: Boolean, default: false },
  canEditSchedule: { type: Boolean, default: false },

  // Notifications
  canSendNotifications: { type: Boolean, default: false },

  // Settings
  canEditClinicSettings: { type: Boolean, default: false },
}, { _id: false });

const EmployeeSchema = new mongoose.Schema({
  // Reference to the doctor who employs this employee
  employerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Employee's user account (references User model)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Job title/position
  position: {
    type: String,
    required: true,
    enum: ['Receptionist', 'Nurse', 'Medical Assistant', 'Office Manager', 'Billing Specialist', 'Other'],
    default: 'Medical Assistant'
  },

  // Employment details
  hireDate: {
    type: Date,
    default: Date.now
  },

  // Salary information (optional)
  salary: {
    amount: { type: Number },
    currency: { type: String, default: 'NIS' },
    frequency: { type: String, enum: ['hourly', 'daily', 'weekly', 'monthly'], default: 'monthly' }
  },

  // Working hours
  workingHours: {
    start: { type: String }, // e.g., "09:00"
    end: { type: String },   // e.g., "17:00"
    days: [{ type: String, enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] }]
  },

  // Permissions and access control
  permissions: {
    type: PermissionSchema,
    default: () => ({})
  },

  // Status
  isActive: {
    type: Boolean,
    default: true
  },

  // Notes
  notes: {
    type: String,
    default: ''
  },

  // Emergency contact
  emergencyContact: {
    name: { type: String },
    phone: { type: String },
    relationship: { type: String }
  }
}, {
  timestamps: true
});

// Indexes for performance
EmployeeSchema.index({ employerId: 1, userId: 1 }, { unique: true });
EmployeeSchema.index({ employerId: 1, isActive: 1 });
EmployeeSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('Employee', EmployeeSchema);