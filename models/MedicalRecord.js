// New MedicalRecord Schema (models/MedicalRecord.js)
const mongoose = require('mongoose');

const MedicalRecordSchema = new mongoose.Schema({
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  doctor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Clinic this record belongs to (for sharing within clinic)
  clinicId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Clinic',
    default: null
  },
  date: {
    type: Date,
    required: true
  },
  // Record type: 'initial' for first visit, 'followup' for follow-up visits
  recordType: {
    type: String,
    enum: ['initial', 'followup'],
    default: 'initial'
  },
  // Reference to parent record for follow-ups (links to the original/initial record)
  parentRecord: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MedicalRecord',
    default: null
  },
  // Visit/appointment number in the treatment journey
  visitNumber: {
    type: Number,
    default: 1
  },
  title: { type: String },
  chiefComplaint: { type: String },
  historyOfPresentIllness: { type: String },
  pastMedicalHistory: { type: String },
  medications: { type: String },
  allergies: { type: String },
  vitals: {
    bloodPressure: { type: String },
    heartRate: { type: String },
    temperature: { type: String },
    weight: { type: String },
    height: { type: String },
    bmi: { type: String },
  },
  examinationFindings: { type: String },
  investigations: { type: String },
  diagnosis: {
    type: String,
    required: true
  },
  treatmentPlan: { type: String },
  treatment: { type: String }, // General treatment description (for all doctors)
  followUpDate: { type: Date },
  
  // Additional info (section 6 - entered by doctor)
  smoking: { type: Boolean, default: null },
  previousDiseases: { type: String },
  disabilities: { type: String },
  
  // Medical assessment (section 7 - entered by doctor)
  clinicalExamination: { type: String },
  preliminaryDiagnosis: { type: String },
  recommendations: { type: String },
  requiredTests: { type: String },
  examinerName: { type: String },
  examDate: { type: Date },
  followUpAppointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' }, // Link to follow-up appointment
  notes: { type: String },
  
  // Dental fields at top level for easy access
  dentalTreatment: { type: String }, // Dental treatment type
  selectedTeeth: [{ 
    toothNumber: { type: Number }, // Universal numbering 1-32
    toothName: { type: String },
    position: { type: String }, // e.g., "Upper Right", "Lower Left"
    condition: { type: String }, // e.g., "filling", "extraction", "root_canal"
    conditionLabel: { type: String }, // Localized label
    notes: { type: String },
    date: { type: Date, default: Date.now }
  }],
  treatmentCost: { type: Number, default: 0 }, // Cost of treatment
  
  // Physical Therapy fields at top level for easy access
  ptTreatment: { type: String }, // PT treatment description
  selectedMuscles: [{
    muscleId: { type: String }, // Muscle identifier
    muscleName: { type: String }, // Display name
    muscleNameAr: { type: String }, // Arabic name
    muscleNameEn: { type: String }, // English name
    region: { type: String }, // Body region (e.g., "shoulder", "back", "thigh")
    regionName: { type: String }, // Localized region name
    treatment: { type: String }, // Treatment type (e.g., "massage", "stretching")
    treatmentName: { type: String }, // Localized treatment name
    treatmentColor: { type: String }, // Color for visualization
    side: { type: String, default: 'both' }, // left, right, both
    notes: { type: String },
    date: { type: Date, default: Date.now }
  }],
  
  // Follow-up specific fields
  followUpNotes: {
    // Progress since last visit
    progressStatus: {
      type: String,
      enum: ['improved', 'stable', 'worsened', 'resolved'],
      default: null
    },
    progressDescription: { type: String },
    // Changes made to treatment
    treatmentChanges: { type: String },
    // New symptoms or complaints
    newSymptoms: { type: String },
    // Response to medications
    medicationResponse: { type: String },
    // Side effects reported
    sideEffects: { type: String },
    // Compliance with treatment
    patientCompliance: {
      type: String,
      enum: ['excellent', 'good', 'fair', 'poor'],
      default: null
    },
    complianceNotes: { type: String },
    // Outcome notes - overall assessment
    outcomeNotes: { type: String },
    // Next steps
    nextSteps: { type: String },
    // Recommendations
    recommendations: { type: String }
  },
  
  specialtyFields: {
    // Cardiology
    ecgFindings: { type: String },
    echocardiogram: { type: String },
    cardiacMarkers: { type: String },
    // Neurology
    neurologicalExam: { type: String },
    mriFindings: { type: String },
    ctFindings: { type: String },
    // Orthopedics
    rangeOfMotion: { type: String },
    xrayFindings: { type: String },
    jointAssessment: { type: String },
    // Gynecology
    lastMenstrualPeriod: { type: Date },
    pregnancyStatus: { type: String },
    papSmearResult: { type: String },
    // Pediatrics
    developmentalMilestones: { type: String },
    vaccinationStatus: { type: String },
    growthCharts: { type: String },
    // Dermatology
    skinLesionDescription: { type: String },
    biopsyResults: { type: String },
    dermatologicalExam: { type: String },
    // Ophthalmology
    visualAcuity: { type: String },
    intraocularPressure: { type: String },
    fundusExam: { type: String },
    // ENT
    hearingTest: { type: String },
    nasalExam: { type: String },
    throatExam: { type: String },
    // Psychiatry
    mentalStatusExam: { type: String },
    psychiatricHistory: { type: String },
    riskAssessment: { type: String },
    // Dentistry
    dentalTreatment: { type: String }, // Description of dental treatment performed
    selectedTeeth: [{ 
      toothNumber: { type: Number }, // Universal numbering 1-32
      toothName: { type: String },
      position: { type: String }, // e.g., "Upper Right", "Lower Left"
      condition: { type: String }, // e.g., "Cavity", "Extraction", "Filling", "Root Canal"
      notes: { type: String }
    }],
    dentalChart: { type: String }, // JSON string of full dental chart state
    treatmentCost: { type: Number, default: 0 }, // Cost of dental treatment
    // Physical Therapy
    ptTreatment: { type: String }, // PT treatment description
    selectedMuscles: [{
      muscleId: { type: String },
      muscleName: { type: String },
      muscleNameAr: { type: String },
      muscleNameEn: { type: String },
      region: { type: String },
      regionName: { type: String },
      treatment: { type: String },
      treatmentName: { type: String },
      treatmentColor: { type: String },
      side: { type: String },
      notes: { type: String },
      date: { type: Date }
    }],
    muscleChart: { type: String }, // JSON string of full muscle chart state
    // General
    additionalNotes: { type: String },
  },
  attachments: [{ type: String }],
  // Audit: who last edited this record
  lastEditedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  lastEditedAt: {
    type: Date,
    default: null
  },
}, {
  timestamps: true
});

// Indexes for clinic-wide queries
MedicalRecordSchema.index({ clinicId: 1, patient: 1 });
MedicalRecordSchema.index({ doctor: 1, patient: 1 });

module.exports = mongoose.model('MedicalRecord', MedicalRecordSchema);