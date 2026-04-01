// AI Assistant Routes
const express = require('express');
const router = express.Router();
const { 
  generateClinicalNotes, 
  checkDrugInteractions, 
  generatePatientSummary,
  suggestDiagnosis 
} = require('../services/aiService');
const User = require('../models/User');
const MedicalRecord = require('../models/MedicalRecord');
const EPrescription = require('../models/EPrescription');
const LabRequest = require('../models/LabRequest');

// Middleware to verify doctor role
const verifyDoctor = async (req, res, next) => {
  try {
    const doctorId = req.body.doctorId || req.query.doctorId;
    if (!doctorId) {
      return res.status(401).json({ success: false, message: 'Doctor ID required' });
    }
    
    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== 'Doctor') {
      return res.status(403).json({ success: false, message: 'Access denied. Doctors only.' });
    }
    
    req.doctor = doctor;
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: 'Authentication error' });
  }
};

/**
 * POST /api/ai/generate-notes
 * Generate SOAP clinical notes from symptoms
 */
router.post('/generate-notes', verifyDoctor, async (req, res) => {
  try {
    const { symptoms, patientId, vitals, language } = req.body;
    
    if (!symptoms) {
      return res.status(400).json({ 
        success: false, 
        message: language === 'ar' ? 'الأعراض مطلوبة' : 'Symptoms are required' 
      });
    }

    // Get patient info if patientId provided
    let patientInfo = {};
    if (patientId) {
      const patient = await User.findById(patientId).lean();
      if (patient) {
        // Calculate age from birthdate
        let age = null;
        if (patient.birthdate) {
          const birthDate = new Date(patient.birthdate);
          const today = new Date();
          age = today.getFullYear() - birthDate.getFullYear();
        }
        
        patientInfo = {
          fullName: patient.fullName,
          age: age,
          sex: patient.sex,
          bloodType: patient.bloodType,
          allergies: patient.allergies || [],
          chronicConditions: patient.chronicConditions || [],
          medications: patient.medications || [],
          pastIllnesses: patient.pastIllnesses || []
        };
      }
    }

    const result = await generateClinicalNotes({
      symptoms,
      patientInfo,
      vitals: vitals || {},
      language: language || 'en'
    });

    res.json({
      success: true,
      data: result,
      message: language === 'ar' ? 'تم إنشاء الملاحظات السريرية بنجاح' : 'Clinical notes generated successfully'
    });

  } catch (error) {
    console.error('Generate notes error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate clinical notes'
    });
  }
});

/**
 * POST /api/ai/check-interactions
 * Check drug interactions
 */
router.post('/check-interactions', verifyDoctor, async (req, res) => {
  try {
    const { drugs, patientId, language } = req.body;
    
    if (!drugs || !Array.isArray(drugs) || drugs.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: language === 'ar' ? 'قائمة الأدوية مطلوبة' : 'Drug list is required' 
      });
    }

    // Get patient info for allergy check
    let patientInfo = {};
    if (patientId) {
      const patient = await User.findById(patientId).lean();
      if (patient) {
        patientInfo = {
          allergies: patient.allergies || [],
          chronicConditions: patient.chronicConditions || []
        };
      }
    }

    const result = await checkDrugInteractions({
      drugs,
      patientInfo,
      language: language || 'en'
    });

    res.json({
      success: true,
      data: result,
      message: language === 'ar' ? 'تم فحص التفاعلات الدوائية' : 'Drug interactions checked'
    });

  } catch (error) {
    console.error('Check interactions error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to check drug interactions'
    });
  }
});

/**
 * POST /api/ai/patient-summary
 * Generate comprehensive patient summary
 */
router.post('/patient-summary', verifyDoctor, async (req, res) => {
  try {
    const { patientId, language } = req.body;
    
    if (!patientId) {
      return res.status(400).json({ 
        success: false, 
        message: language === 'ar' ? 'معرف المريض مطلوب' : 'Patient ID is required' 
      });
    }

    // Get patient data
    const patient = await User.findById(patientId).lean();
    if (!patient) {
      return res.status(404).json({ 
        success: false, 
        message: language === 'ar' ? 'المريض غير موجود' : 'Patient not found' 
      });
    }

    // Get medical records
    const medicalRecords = await MedicalRecord.find({ patient: patientId })
      .sort({ date: -1 })
      .limit(10)
      .lean();

    // Get prescriptions
    const prescriptions = await EPrescription.find({ patientId: patientId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    // Get lab results
    const labResults = await LabRequest.find({ patientId: patientId, status: 'completed' })
      .sort({ completedDate: -1 })
      .limit(5)
      .lean();

    const result = await generatePatientSummary({
      patient,
      medicalRecords,
      prescriptions,
      labResults,
      language: language || 'en'
    });

    res.json({
      success: true,
      data: result,
      message: language === 'ar' ? 'تم إنشاء ملخص المريض' : 'Patient summary generated'
    });

  } catch (error) {
    console.error('Patient summary error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate patient summary'
    });
  }
});

/**
 * POST /api/ai/suggest-diagnosis
 * Quick diagnosis suggestion based on symptoms
 */
router.post('/suggest-diagnosis', verifyDoctor, async (req, res) => {
  try {
    const { symptoms, patientId, language } = req.body;
    
    if (!symptoms) {
      return res.status(400).json({ 
        success: false, 
        message: language === 'ar' ? 'الأعراض مطلوبة' : 'Symptoms are required' 
      });
    }

    // Get patient age and sex if available
    let age = null;
    let sex = null;
    if (patientId) {
      const patient = await User.findById(patientId).lean();
      if (patient) {
        sex = patient.sex;
        if (patient.birthdate) {
          const birthDate = new Date(patient.birthdate);
          const today = new Date();
          age = today.getFullYear() - birthDate.getFullYear();
        }
      }
    }

    const result = await suggestDiagnosis({
      symptoms,
      age,
      sex,
      language: language || 'en'
    });

    res.json({
      success: true,
      data: result,
      message: language === 'ar' ? 'تم اقتراح التشخيصات' : 'Diagnoses suggested'
    });

  } catch (error) {
    console.error('Suggest diagnosis error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to suggest diagnosis'
    });
  }
});

/**
 * GET /api/ai/status
 * Check if AI service is configured
 */
router.get('/status', (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  res.json({
    success: true,
    configured: !!apiKey && apiKey !== 'YOUR_GEMINI_API_KEY',
    provider: 'Google Gemini',
    model: 'gemini-1.5-flash',
    features: ['clinical-notes', 'drug-interactions', 'patient-summary', 'diagnosis-suggestions']
  });
});

module.exports = router;
