// AI Assistant Routes
const express = require('express');
const router = express.Router();
const { 
  generateClinicalNotes, 
  checkDrugInteractions, 
  generatePatientSummary, 
  suggestDiagnosis,
  patientAssistantChat,
  analyzePatientReportOrImage,
  doctorAssistantChat,
  doctorAssistantAnalyzeFile,
  pharmacyDrugCheck,
  pharmacyAssistantChat
} = require('../services/aiService');
const User = require('../models/User');
const MedicalRecord = require('../models/MedicalRecord');
const EPrescription = require('../models/EPrescription');
const LabRequest = require('../models/LabRequest');
const ImageRequest = require('../models/ImageRequest');

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

// Middleware to verify patient role
const verifyPatient = async (req, res, next) => {
  try {
    const patientId = req.body.patientId || req.query.patientId;
    if (!patientId) {
      return res.status(401).json({ success: false, message: 'Patient ID required' });
    }

    const patient = await User.findById(patientId);
    if (!patient || patient.role !== 'User') {
      return res.status(403).json({ success: false, message: 'Access denied. Patients only.' });
    }

    req.patient = patient;
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: 'Authentication error' });
  }
};

const escapeRegExp = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const asksForAdvice = (message = '') => {
  const text = String(message || '').toLowerCase();
  const advicePattern = /(نصيحة|نصائح|شو اعمل|ماذا افعل|بماذا تنصح|اعطني علاج|اعطيني علاج|treatment advice|what should i do|medical advice|advice)/i;
  return advicePattern.test(text);
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
 * POST /api/ai/patient-assistant/chat
 * Patient-safe assistant: explains history/reports and routes to best doctor by city + specialty.
 * No treatment advice is provided.
 */
router.post('/patient-assistant/chat', verifyPatient, async (req, res) => {
  try {
    const { patientId, message, city, language, conversationHistory } = req.body;
    const lang = language === 'ar' ? 'ar' : 'en';

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        success: false,
        message: lang === 'ar' ? 'رسالة المستخدم مطلوبة' : 'User message is required'
      });
    }

    if (asksForAdvice(message)) {
      const adviceReply = lang === 'ar'
        ? 'توجه لطبيب مختص حسب حالتك، وإذا بتحب احكيلي حالتك وأنا بساعدك عند مين تروح.'
        : 'Please visit a specialist doctor based on your condition. If you want, tell me your symptoms and I will help you choose the right specialty doctor.';

      return res.json({
        success: true,
        data: {
          responseType: 'advice_refusal',
          assistantMessage: adviceReply,
          needsCity: false,
          needsDoctorReferral: true,
          doctors: []
        }
      });
    }

    const patient = await User.findById(patientId)
      .select('fullName sex birthdate city bloodType allergies chronicConditions medications pastIllnesses hasChronicDiseases chronicDiseasesText hasSurgeries surgeriesText hasFamilyDiseases familyDiseasesText bloodPressure heartRate temperature bloodSugar smoking previousDiseases disabilities')
      .lean();

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: lang === 'ar' ? 'المريض غير موجود' : 'Patient not found'
      });
    }

    const [medicalRecords, labResults, imageRequests] = await Promise.all([
      MedicalRecord.find({ patient: patientId })
        .sort({ date: -1, createdAt: -1 })
        .limit(12)
        .select('date title chiefComplaint historyOfPresentIllness diagnosis preliminaryDiagnosis examinationFindings investigations treatmentPlan followUpNotes notes vitals')
        .lean(),
      LabRequest.find({ patientId, status: 'completed' })
        .sort({ completedDate: -1, updatedAt: -1 })
        .limit(10)
        .select('completedDate notes testName results')
        .lean(),
      ImageRequest.find({ patientId, status: 'completed' })
        .sort({ completedDate: -1, updatedAt: -1 })
        .limit(10)
        .select('completedDate imageType bodyPart findings radiologistNotes notes images.fileUrl images.notes')
        .lean()
    ]);

    console.log(`🤖 AI Chat Request: message="${message}", city="${city}", language="${lang}"`);
    console.log(`👤 Patient city: ${patient.city}`);
    
    const aiResult = await patientAssistantChat({
      message,
      language: lang,
      city: city || patient.city || '',
      conversationHistory: Array.isArray(conversationHistory) ? conversationHistory.slice(-8) : [],
      patientContext: {
        profile: patient,
        medicalRecords,
        labResults,
        imageRequests
      }
    });

    // Enhanced city name mapping for Arabic/English standardization
    const cityMapping = {
      'رام الله': 'Ramallah',
      'ramallah': 'Ramallah', 
      'Ramallah': 'Ramallah',
      'نابلس': 'Nablus', 
      'nablus': 'Nablus',
      'Nablus': 'Nablus',
      'NABLUS': 'Nablus',
      'الخليل': 'Hebron',
      'hebron': 'Hebron', 
      'Hebron': 'Hebron'
    };

    // Extract city from AI result or message
    let extractedCity = aiResult.city || city || patient.city || '';
    
    // If no city found, try to extract from the message
    if (!extractedCity && message) {
      const messageLower = message.toLowerCase();
      
      // Check for Arabic city names
      if (messageLower.includes('نابلس')) {
        extractedCity = 'Nablus';
      } else if (messageLower.includes('رام الله')) {
        extractedCity = 'Ramallah';
      } else if (messageLower.includes('الخليل')) {
        extractedCity = 'Hebron';
      } else {
        // Check for English city names
        for (const [cityName, standardName] of Object.entries(cityMapping)) {
          if (messageLower.includes(cityName.toLowerCase())) {
            extractedCity = standardName;
            break;
          }
        }
      }
    }
    
    // Standardize city name using mapping
    const finalCity = cityMapping[extractedCity] || extractedCity;
    console.log(`City extraction: message="${message}" -> extracted="${extractedCity}" -> final="${finalCity}"`);
    
    let doctors = [];

    // Handle different response types - be more selective about when to show doctors
    console.log(`AI Response Type: ${aiResult.responseType}, needsDoctorReferral: ${aiResult.needsDoctorReferral}, detectedSpecialty: ${aiResult.detectedSpecialty}`);
    
    if (aiResult.responseType === 'list_doctors' && finalCity) {
      console.log(`Searching for doctors in city: ${finalCity}`);
      // For general doctor listing questions like "who are the doctors in Nablus?"
      doctors = await User.find({
        role: 'Doctor',
        activationStatus: 'active',
        city: finalCity
      })
        .select('_id fullName city specialty address mobileNumber rating ratingsCount yearsOfExperience consultationFee workplaces profileImage')
        .sort({ specialty: 1, rating: -1, ratingsCount: -1 })
        .limit(10)
        .lean();
        
      console.log(`Found ${doctors.length} doctors in ${finalCity}`);
    } else if (aiResult.responseType === 'doctor_referral' && aiResult.needsDoctorReferral && aiResult.detectedSpecialty && finalCity) {
      // For medical routing questions with specific specialty
      console.log(`Searching for specialty "${aiResult.detectedSpecialty}" in city "${finalCity}"`);
      
      // Enhanced specialty matching
      const specialtyMappings = {
        'طب الأسنان': /أسنان|dental|dentist/i,
        'الباطنة': /باطنة|internal|general practice/i,
        'الجراحة العامة': /جراحة|surgery/i,
        'النساء والتوليد': /نساء|توليد|gynecology|obstetrics/i,
        'الأطفال': /أطفال|pediatric/i,
        'الجلدية': /جلدية|dermatology/i,
        'العيون': /عيون|eye|ophthalmology/i,
        'الأنف والأذن والحنجرة': /أنف|أذن|حنجرة|ent/i,
        'العظام': /عظام|orthopedic/i,
        'القلبية': /قلب|cardiology/i,
        'الصدرية': /صدر|pulmonology/i,
        'البولية': /بولية|urology/i,
        'الطب النفسي': /نفسي|psychiatry/i,
        'الأعصاب': /أعصاب|neurology/i
      };

      let specialtyPattern = new RegExp(escapeRegExp(aiResult.detectedSpecialty), 'i');
      
      // Try to match with specialty mappings for better accuracy
      for (const [arSpecialty, pattern] of Object.entries(specialtyMappings)) {
        if (pattern.test(aiResult.detectedSpecialty)) {
          specialtyPattern = pattern;
          break;
        }
      }

      doctors = await User.find({
        role: 'Doctor',
        activationStatus: 'active',
        city: finalCity,
        specialty: specialtyPattern
      })
        .select('_id fullName city specialty address mobileNumber rating ratingsCount yearsOfExperience consultationFee workplaces profileImage')
        .sort({ rating: -1, ratingsCount: -1, yearsOfExperience: -1 })
        .limit(5)
        .lean();

      console.log(`Found ${doctors.length} doctors with specialty "${aiResult.detectedSpecialty}" in "${finalCity}"`);

      // If no exact specialty match found, don't fallback to all doctors
      if (!doctors.length) {
        console.log(`No doctors found for specialty "${aiResult.detectedSpecialty}" in "${finalCity}"`);
      }
    }

    console.log(`🎯 Final result - responseType: ${aiResult.responseType}, needsDoctorReferral: ${aiResult.needsDoctorReferral}, doctors: ${doctors.length}, city: ${finalCity}`);

    res.json({
      success: true,
      data: {
        ...aiResult,
        city: finalCity || null,
        doctors
      },
      message: lang === 'ar' ? 'تمت معالجة طلب المساعد الذكي بنجاح' : 'Patient assistant request processed successfully'
    });
  } catch (error) {
    console.error('Patient assistant chat error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to process patient assistant request'
    });
  }
});

/**
 * POST /api/ai/patient-assistant/analyze-report
 * Analyze report text and/or medical image in simple patient language without treatment advice.
 */
router.post('/patient-assistant/analyze-report', verifyPatient, async (req, res) => {
  try {
    const { patientId, reportText, imageBase64, mimeType, language } = req.body;
    const lang = language === 'ar' ? 'ar' : 'en';

    if (!reportText && !imageBase64) {
      return res.status(400).json({
        success: false,
        message: lang === 'ar' ? 'نص التقرير أو صورة الأشعة مطلوبة' : 'Report text or medical image is required'
      });
    }

    const patient = await User.findById(patientId)
      .select('fullName sex birthdate city bloodType allergies chronicConditions medications pastIllnesses')
      .lean();

    const analysis = await analyzePatientReportOrImage({
      reportText,
      imageBase64,
      mimeType,
      language: lang,
      patientContext: {
        profile: patient || {}
      }
    });

    res.json({
      success: true,
      data: analysis,
      message: lang === 'ar' ? 'تم تحليل التقرير/الصورة بنجاح' : 'Report/image analyzed successfully'
    });
  } catch (error) {
    console.error('Patient analyze report error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to analyze report/image'
    });
  }
});

/**
 * POST /api/ai/doctor-assistant-chat
 * Doctor AI Assistant Chat - helps doctors with patient management, medical analysis, and financial data
 */
router.post('/doctor-assistant-chat', async (req, res) => {
  try {
    const { message, doctorId, conversationHistory, language } = req.body;
    
    if (!message || !doctorId) {
      return res.status(400).json({
        success: false,
        message: language === 'ar' ? 'الرسالة ومعرف الطبيب مطلوبان' : 'Message and doctor ID are required'
      });
    }

    console.log('Doctor assistant chat request:', { doctorId, messageLength: message.length });

    const result = await doctorAssistantChat({
      message,
      doctorId,
      conversationHistory: conversationHistory || [],
      language: language || 'ar'
    });

    // Fallback: استخرج اسم المريض من الرسالة إذا ما جاب الـ AI
    if (!result.patientName && result.responseType === 'patient_record') {
      const messageLower = message.toLowerCase();
      const stopWords = ['اقرأ', 'ملف', 'مريض', 'اعرض', 'شو', 'هاي', 'هذا', 'ذاك', 'تحليل', 'اعطيني', 'لي', 'دقيق', 'للمريض'];
      const messageWords = message.split(/\s+/);
      
      for (const word of messageWords) {
        if (word.length > 2 && !stopWords.includes(word.toLowerCase())) {
          result.patientName = word;
          break;
        }
      }
      console.log(`⚠️ Fallback: Extracted patient name from message: "${result.patientName}"`);
    }

    // جلب البيانات الفعلية بناءً على نوع الطلب
    let responseData = null;

    console.log(`\n=== Doctor Assistant Chat Processing ===`);
    console.log(`Response Type: ${result.responseType}`);
    console.log(`Patient Name: ${result.patientName || 'none'}`);
    console.log(`Message: "${message}"\n`);

    if (result.responseType === 'patient_list') {
      // جلب قائمة مرضى الدكتور
      const doctor = await User.findById(doctorId).lean();
      const patients = await User.find({
        _id: { $in: doctor.patients || [] },
        role: 'User'
      }).select('_id fullName mobileNumber email specialty city').lean();
      
      if (!patients || patients.length === 0) {
        result.assistantMessage = language === 'ar' 
          ? '❌ لا توجد لديك مرضى مسجلين حالياً.'
          : '❌ You have no registered patients currently.';
      } else {
        responseData = {
          patients: patients || [],
          count: patients?.length || 0
        };

        result.assistantMessage = language === 'ar' 
          ? `✅ لديك ${patients?.length || 0} مريض${patients?.length !== 1 ? 'اً' : ''}:\n\n` + 
            (patients?.map(p => `• ${p.fullName} (${p.mobileNumber})`).join('\n') || 'لا توجد مرضى حالياً')
          : `✅ You have ${patients?.length || 0} patient${patients?.length !== 1 ? 's' : ''}:\n\n` +
            (patients?.map(p => `• ${p.fullName} (${p.mobileNumber})`).join('\n') || 'No patients yet');
      }
    } else if (result.responseType === 'financial_report') {
      // جلب التقارير المالية
      const doctor = await User.findById(doctorId).lean();
      
      // هنا لازم نحسب الإيرادات من الـ appointments مثلاً
      // بشكل مؤقت نرسل رسالة توضيحية
      result.assistantMessage = language === 'ar'
        ? `⚠️ معلومة: البيانات المالية ليست متوفرة حالياً في النظام.\n\nلا توجد سجلات مالية أو لم يتم تسجيل أي دفعات بعد.\n\n💡 تلميح: تأكد من تسجيل الفواتير والدفعات في النظام لعرض التقارير المالية.`
        : `⚠️ Note: Financial data is not currently available in the system.\n\nNo financial records or payments have been recorded yet.\n\n💡 Tip: Make sure to register invoices and payments in the system to display financial reports.`;
    } else if (result.responseType === 'clinic_stats') {
      // إحصائيات العيادة
      result.assistantMessage = language === 'ar'
        ? `📊 إحصائيات العيادة:\n\n⚠️ البيانات الإحصائية ليست متوفرة حالياً.\n\n💡 سيتم إضافة هذه الميزة قريباً.`
        : `📊 Clinic Statistics:\n\n⚠️ Statistical data is not currently available.\n\n💡 This feature will be added soon.`;
    } else if (result.responseType === 'patient_record') {
      // جلب ملف مريض معين
      let patientId = result.patientId;
      const doctor = await User.findById(doctorId).lean();
      
      // حاول استخدام اسم المريض من الـ AI أولاً
      let patientName = result.patientName;
      
      console.log(`\n>>> Patient Record Search:`);
      console.log(`   - patientId from AI: ${patientId || 'none'}`);
      console.log(`   - patientName from AI: ${patientName || 'none'}`);
      
      // تجاهل معرف المريض إذا كان نصاً عاماً من الـ AI
      if (patientId && (patientId.length < 24 || patientId === 'معرف المريض إن وجد' || !patientId.match(/^[0-9a-f]{24}$/i))) {
        patientId = null;
      }
      
      // إذا لم يتم تحديد معرف المريض، ابحث عن المريض بالاسم من الرسالة أو من الـ AI
      if (!patientId) {
        const messageLower = message.toLowerCase();
        const stopWords = ['اقرأ', 'ملف', 'مريض', 'اعرض', 'شو', 'هاي', 'هذا', 'ذاك', 'التقارير', 'الروشيتات', 'و', 'أو', 'من', 'في', 'على', 'عن', 'إلى', 'هل', 'ما', 'لا', 'نعم', 'أيضاً', 'كذلك', 'تحليل', 'اعطيني', 'لي', 'عن'];
        
        try {
          // جلب جميع مرضى الدكتور
          const doctorPatients = await User.find({
            _id: { $in: doctor.patients || [] },
            role: 'User'
          }).select('_id fullName').lean();
          
          console.log(`   - Searching among ${doctorPatients.length} patients`);
          console.log(`   - Search sources: message="${message}", aiName="${patientName}"`);
          
          // ابحث عن أفضل تطابق باسم المريض
          let bestMatch = null;
          let bestScore = 0;
          
          // البحث 1: اسم المريض من الـ AI
          if (patientName) {
            for (const patient of doctorPatients) {
              if (patient.fullName.toLowerCase().includes(patientName.toLowerCase()) || 
                  patientName.toLowerCase().includes(patient.fullName.toLowerCase())) {
                console.log(`   ✅ [AI Name Match] "${patientName}" matched with "${patient.fullName}"`);
                bestMatch = patient;
                bestScore = 90;
                break;
              }
            }
          }
          
          // البحث 2: من الرسالة
          if (!bestMatch) {
            for (const patient of doctorPatients) {
              const patientNameLower = patient.fullName.toLowerCase();
              
              // التحقق من تطابق الاسم الكامل
              if (messageLower.includes(patientNameLower)) {
                console.log(`   ✅ [Full Name Match] "${patientNameLower}" found in message`);
                bestMatch = patient;
                bestScore = 100;
                break;
              }
              
              // التحقق من تطابق الأجزاء (الاسم الأول أو الأخير)
              const nameParts = patientNameLower.split(/\s+/);
              for (const part of nameParts) {
                if (part.length > 2 && !stopWords.includes(part)) {
                  // البحث عن الكلمة الكاملة أو كجزء
                  const partRegex = new RegExp(`(\\b${part}\\b|${part})`, 'i');
                  if (partRegex.test(messageLower)) {
                    console.log(`   ✅ [Part Match] "${part}" matched with "${patient.fullName}"`);
                    const score = part.length > 3 ? 75 : 50;
                    if (score > bestScore) {
                      bestMatch = patient;
                      bestScore = score;
                    }
                  }
                }
              }
              
              // التحقق من تطابق كل كلمة في الرسالة مع أجزاء الاسم
              const messageWords = message.split(/\s+/);
              for (const word of messageWords) {
                const wordLower = word.toLowerCase();
                if (wordLower.length > 2 && !stopWords.includes(wordLower)) {
                  for (const namePart of nameParts) {
                    if (namePart.length > 2 && !stopWords.includes(namePart)) {
                      // تحقق من التشابه (مثل nassersayeh vs ناصر السايح)
                      if (wordLower.includes(namePart) || namePart.includes(wordLower) || 
                          (wordLower.length > 3 && namePart.includes(wordLower.substring(0, 3)))) {
                        console.log(`   ✅ [Word Match] "${wordLower}" similar to "${namePart}" (${patient.fullName})`);
                        const score = 60;
                        if (score > bestScore) {
                          bestMatch = patient;
                          bestScore = score;
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          
          if (bestMatch && bestScore > 0) {
            patientId = bestMatch._id.toString();
            console.log(`   ✅ FOUND: ${bestMatch.fullName} (ID: ${patientId}, score: ${bestScore})`);
          } else {
            console.log(`   ❌ NO MATCH FOUND`);
          }
        } catch (searchError) {
          console.log('   ❌ Patient search error:', searchError.message);
        }
      }

      // تحقق من أن patientId هو string وليس ObjectId
      if (typeof patientId !== 'string') {
        patientId = patientId?.toString?.() || null;
      }

      if (patientId && patientId.match(/^[0-9a-f]{24}$/i)) {
        try {
          const patient = await User.findById(patientId).lean();
          const medicalRecords = await MedicalRecord.find({
            patient: patientId,
            doctor: doctorId
          }).sort({ date: -1 }).limit(10).lean();

          const prescriptions = await EPrescription.find({
            patientId: patientId,
            doctorId: doctorId
          }).sort({ date: -1 }).limit(10).lean();

          responseData = {
            patient: {
              name: patient?.fullName,
              mobileNumber: patient?.mobileNumber,
              email: patient?.email,
              city: patient?.city,
              age: patient?.birthdate ? new Date().getFullYear() - new Date(patient.birthdate).getFullYear() : null,
              bloodType: patient?.bloodType
            },
            medicalRecords: medicalRecords?.map(r => ({
              title: r.title,
              diagnosis: r.diagnosis,
              date: r.date,
              recommendations: r.recommendations
            })) || [],
            prescriptions: prescriptions?.map(p => ({
              medications: p.products?.map(prod => prod.name).join(', ') || 'N/A',
              diagnosis: p.diagnosis,
              date: p.date,
              expiryDate: p.expiryDate
            })) || [],
            recordCount: medicalRecords?.length || 0,
            prescriptionCount: prescriptions?.length || 0
          };

          result.assistantMessage = language === 'ar' 
            ? `📋 **تقرير طبي شامل - المريض: ${patient?.fullName}**

---

**بيانات المريض الأساسية:**

المريض ${patient?.fullName} يبلغ من العمر ${patient?.birthdate ? new Date().getFullYear() - new Date(patient.birthdate).getFullYear() : 'غير محدد'} سنة، يسكن في ${patient?.city || 'غير محدد'}.

- الهاتف: ${patient?.mobileNumber || 'غير محدد'}
- البريد الإلكتروني: ${patient?.email || 'غير محدد'}
- فصيلة الدم: ${patient?.bloodType || 'غير محدد'}

---

**التقارير الطبية (${medicalRecords?.length || 0} تقرير):**

${medicalRecords?.map((r, idx) => {
      const dateStr = new Date(r.date).toLocaleDateString('ar-SA');
      return `${idx + 1}. ${r.title}\n   📅 التاريخ: ${dateStr}\n   🔍 النتيجة: ${r.diagnosis}\n   💡 التوصيات: ${r.recommendations || 'لا توجد توصيات محددة'}`;
    }).join('\n\n') || 'لا توجد تقارير طبية'}

---

**الروشيتات الدوائية (${prescriptions?.length || 0} روشيتة):**

${prescriptions?.map((p, idx) => {
      const dateStr = new Date(p.date).toLocaleDateString('ar-SA');
      const expiryStr = p.expiryDate ? new Date(p.expiryDate).toLocaleDateString('ar-SA') : 'غير محدد';
      const medicationsText = p.products && p.products.length > 0 
        ? p.products.map((med, i) => `${med.name} - ${med.dose}${med.instructions ? ` (${med.instructions})` : ''}`).join(' | ')
        : 'أدوية غير محددة';
      return `${idx + 1}. 💊 ${medicationsText}\n   🏥 المؤشر الطبي: ${p.diagnosis}\n   📅 التاريخ: ${dateStr}\n   ⏰ انتهاء الصلاحية: ${expiryStr}`;
    }).join('\n\n') || 'لا توجد روشيتات دوائية'}

---

**ملخص الحالة:**
✅ عدد التقارير: ${medicalRecords?.length || 0}
✅ عدد الروشيتات: ${prescriptions?.length || 0}
✅ آخر تحديث: ${medicalRecords?.[0]?.date ? new Date(medicalRecords[0].date).toLocaleDateString('ar-SA') : 'لا توجد بيانات'}`
            : `📋 **Comprehensive Medical Report - Patient: ${patient?.fullName}**

---

**Patient Basic Information:**

Patient ${patient?.fullName} is ${patient?.birthdate ? new Date().getFullYear() - new Date(patient.birthdate).getFullYear() : 'Not specified'} years old, residing in ${patient?.city || 'Not specified'}.

- Contact: ${patient?.mobileNumber || 'Not specified'}
- Email: ${patient?.email || 'Not specified'}
- Blood Type: ${patient?.bloodType || 'Not specified'}

---

**Medical Reports (${medicalRecords?.length || 0} records):**

${medicalRecords?.map((r, idx) => {
      const dateStr = new Date(r.date).toLocaleDateString('en-US');
      return `${idx + 1}. ${r.title}\n   📅 Date: ${dateStr}\n   🔍 Finding: ${r.diagnosis}\n   💡 Recommendations: ${r.recommendations || 'No specific recommendations'}`;
    }).join('\n\n') || 'No medical records found'}

---

**Active Prescriptions (${prescriptions?.length || 0} prescriptions):**

${prescriptions?.map((p, idx) => {
      const dateStr = new Date(p.date).toLocaleDateString('en-US');
      const expiryStr = p.expiryDate ? new Date(p.expiryDate).toLocaleDateString('en-US') : 'Not specified';
      const medicationsText = p.products && p.products.length > 0 
        ? p.products.map((med, i) => `${med.name} - ${med.dose}${med.instructions ? ` (${med.instructions})` : ''}`).join(' | ')
        : 'Unspecified medications';
      return `${idx + 1}. 💊 ${medicationsText}\n   🏥 Indication: ${p.diagnosis}\n   📅 Date: ${dateStr}\n   ⏰ Expiry: ${expiryStr}`;
    }).join('\n\n') || 'No prescriptions found'}

---

**Case Summary:**
✅ Medical Records: ${medicalRecords?.length || 0}
✅ Active Prescriptions: ${prescriptions?.length || 0}
✅ Last Updated: ${medicalRecords?.[0]?.date ? new Date(medicalRecords[0].date).toLocaleDateString('en-US') : 'No data'}`;
        } catch (error) {
          console.error('Error fetching patient data:', error);
          result.assistantMessage = language === 'ar'
            ? 'عذراً، حدث خطأ أثناء جلب بيانات المريض.'
            : 'Sorry, an error occurred while fetching patient data.';
        }
      } else {
        result.assistantMessage = language === 'ar'
          ? 'عذراً، لم أتمكن من العثور على المريض المطلوب.'
          : 'Sorry, I could not find the requested patient.';
      }
    }


    res.json({
      success: true,
      data: {
        ...result,
        responseData: responseData
      },
      message: language === 'ar' ? 'تمت معالجة الطلب بنجاح' : 'Request processed successfully'
    });
  } catch (error) {
    console.error('Doctor assistant chat error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to process doctor assistant chat'
    });
  }
});

/**
 * POST /api/ai/doctor-assistant-analyze-file
 * Doctor AI Assistant File Analysis - analyze medical files, lab results, imaging
 */
router.post('/doctor-assistant-analyze-file', async (req, res) => {
  try {
    const { message, fileData, fileName, doctorId, language } = req.body;
    
    if (!fileData || !fileName || !doctorId) {
      return res.status(400).json({
        success: false,
        message: language === 'ar' ? 'بيانات الملف واسم الملف ومعرف الطبيب مطلوبة' : 'File data, file name, and doctor ID are required'
      });
    }

    console.log('Doctor file analysis request:', { 
      doctorId, 
      fileName, 
      messageLength: message?.length || 0 
    });

    const result = await doctorAssistantAnalyzeFile({
      message: message || '',
      fileData,
      fileName,
      doctorId,
      language: language || 'ar'
    });

    res.json({
      success: true,
      data: result,
      message: language === 'ar' ? 'تم تحليل الملف بنجاح' : 'File analyzed successfully'
    });
  } catch (error) {
    console.error('Doctor file analysis error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to analyze file'
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
    features: ['clinical-notes', 'drug-interactions', 'patient-summary', 'diagnosis-suggestions', 'patient-assistant-chat', 'doctor-assistant-chat', 'doctor-assistant-analyze-file', 'pharmacy-drug-check']
  });
});

/**
 * POST /api/ai/pharmacy-drug-check
 * Pharmacy AI Assistant - Check drug interactions
 * Pharmacist provides patient ID and proposed medication
 * AI checks against patient's current medications
 */
router.post('/pharmacy-drug-check', async (req, res) => {
  try {
    const { patientId, medicationName, pharmacyId, language } = req.body;
    
    console.log('=== PHARMACY DRUG CHECK REQUEST ===');
    console.log('Request body:', { patientId, medicationName, pharmacyId, language });
    
    if (!patientId || !medicationName) {
      console.log('❌ Missing required fields');
      return res.status(400).json({
        success: false,
        message: language === 'ar' ? 'رقم الهوية واسم الدواء مطلوبان' : 'Patient ID and medication name are required'
      });
    }

    console.log('✅ Required fields present');
    console.log('Pharmacy drug check request:', { 
      patientId, 
      medicationName,
      pharmacyId 
    });

    // Search by mobile number
    console.log('Searching patient by mobile number:', patientId);
    let searchQuery = { mobileNumber: patientId, role: 'User' };

    const patient = await User.findOne(searchQuery).lean();
    
    console.log('Patient search result:', patient ? `Found: ${patient.fullName}` : 'Not found');
    
    if (!patient) {
      console.log('❌ Patient not found');
      return res.status(404).json({
        success: false,
        message: language === 'ar' ? 'المريض غير موجود' : 'Patient not found'
      });
    }

    console.log('✅ Patient found:', { patientId: patient._id, name: patient.fullName });

    // Get patient's current prescriptions
    console.log('Fetching prescriptions for patient:', patient._id);
    const currentPrescriptions = await EPrescription.find({
      patientId: patient._id,
      isValid: true
    }).lean();

    console.log('✅ Found prescriptions:', currentPrescriptions.length);

    // Extract medication names from prescriptions
    const currentMedications = [];
    currentPrescriptions.forEach(prescription => {
      if (prescription.products && Array.isArray(prescription.products)) {
        prescription.products.forEach(product => {
          if (product.name && !currentMedications.includes(product.name)) {
            currentMedications.push(product.name);
          }
        });
      }
    });

    console.log('✅ Current medications:', currentMedications);
    console.log('Proposed medication:', medicationName);

    // Use AI to check for interactions
    console.log('Calling pharmacyDrugCheck function...');
    const interactionAnalysis = await pharmacyDrugCheck({
      patientId: patient._id,
      currentMedications: currentMedications,
      proposedMedication: medicationName,
      language: language || 'ar'
    });

    console.log('✅ Interaction analysis result:', interactionAnalysis);

    res.json({
      success: true,
      data: {
        analysis: interactionAnalysis.analysis,
        hasInteraction: interactionAnalysis.hasInteraction,
        severity: interactionAnalysis.severity,
        patientName: patient.fullName,
        currentMedicationsCount: currentMedications.length,
        proposedMedication: medicationName
      },
      message: language === 'ar' ? 'تم فحص الأدوية بنجاح' : 'Drug check completed successfully'
    });
  } catch (error) {
    console.error('❌ PHARMACY DRUG CHECK ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code
    });
  }
});

/**
 * POST /api/ai/pharmacy-assistant-chat
 * General pharmaceutical questions and drug information
 */
router.post('/pharmacy-assistant-chat', async (req, res) => {
  try {
    const { message, pharmacyId, language } = req.body;
    const lang = language === 'ar' ? 'ar' : 'en';

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        success: false,
        message: lang === 'ar' ? 'الرسالة مطلوبة' : 'Message is required'
      });
    }

    console.log('Pharmacy assistant chat request:', { pharmacyId, messageLength: message.length });

    const result = await pharmacyAssistantChat({
      message,
      language: lang
    });

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('❌ Pharmacy assistant chat error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || (language === 'ar' ? 'حدث خطأ' : 'Error occurred'),
      error: error.message
    });
  }
});

module.exports = router;
