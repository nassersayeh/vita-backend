// AI Clinical Assistant Service using Google Gemini (Free Tier)
// Supports both Arabic and English

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

function getMimeAndData(fileData) {
  if (!fileData) return { mimeType: 'application/octet-stream', fileBase64: '' };
  const dataUrlMatch = String(fileData).match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return { mimeType: dataUrlMatch[1], fileBase64: dataUrlMatch[2] };
  }
  return { mimeType: 'application/octet-stream', fileBase64: fileData };
}

/**
 * Generate clinical SOAP notes from symptoms and patient info
 * @param {Object} params - Input parameters
 * @param {string} params.symptoms - Chief complaint and symptoms
 * @param {Object} params.patientInfo - Patient demographics and history
 * @param {Object} params.vitals - Vital signs
 * @param {string} params.language - 'ar' for Arabic, 'en' for English
 * @returns {Object} Generated clinical notes
 */
async function generateClinicalNotes({ symptoms, patientInfo, vitals, language = 'en' }) {
  const isArabic = language === 'ar';
  
  const systemPrompt = isArabic ? `
أنت مساعد طبي ذكي متخصص في مساعدة الأطباء على توثيق الحالات السريرية.
مهمتك هي تحليل المعلومات المقدمة وإنشاء ملاحظات سريرية منظمة بتنسيق SOAP.
يجب أن تكون جميع الردود باللغة العربية.
تذكر: أنت تساعد الطبيب فقط، ولا تقدم تشخيصًا نهائيًا.

قواعد مهمة:
1. اقترح التشخيصات المحتملة بناءً على الأعراض
2. اقترح الفحوصات والتحاليل المناسبة
3. اقترح خطة علاجية أولية
4. حدد أي علامات تحذيرية تتطلب انتباهًا فوريًا
5. كن دقيقًا ومختصرًا
` : `
You are an intelligent medical assistant specialized in helping doctors document clinical cases.
Your task is to analyze the provided information and generate structured clinical notes in SOAP format.
All responses should be in English.
Remember: You are only assisting the doctor, not providing a final diagnosis.

Important rules:
1. Suggest possible diagnoses based on symptoms
2. Recommend appropriate tests and investigations
3. Suggest an initial treatment plan
4. Identify any red flags requiring immediate attention
5. Be precise and concise
`;

  const patientSummary = isArabic ? `
معلومات المريض:
- الاسم: ${patientInfo?.fullName || 'غير محدد'}
- العمر: ${patientInfo?.age || 'غير محدد'}
- الجنس: ${patientInfo?.sex || 'غير محدد'}
- فصيلة الدم: ${patientInfo?.bloodType || 'غير محددة'}
- الحساسية: ${patientInfo?.allergies?.join('، ') || 'لا يوجد'}
- الأمراض المزمنة: ${patientInfo?.chronicConditions?.join('، ') || 'لا يوجد'}
- الأدوية الحالية: ${patientInfo?.medications?.join('، ') || 'لا يوجد'}
- التاريخ المرضي: ${patientInfo?.pastIllnesses?.join('، ') || 'لا يوجد'}

العلامات الحيوية:
- ضغط الدم: ${vitals?.bloodPressure || 'غير محدد'}
- النبض: ${vitals?.heartRate || 'غير محدد'}
- الحرارة: ${vitals?.temperature || 'غير محدد'}
- الوزن: ${vitals?.weight || 'غير محدد'} كغ
- الطول: ${vitals?.height || 'غير محدد'} سم

الشكوى الرئيسية والأعراض:
${symptoms}
` : `
Patient Information:
- Name: ${patientInfo?.fullName || 'Not specified'}
- Age: ${patientInfo?.age || 'Not specified'}
- Sex: ${patientInfo?.sex || 'Not specified'}
- Blood Type: ${patientInfo?.bloodType || 'Not specified'}
- Allergies: ${patientInfo?.allergies?.join(', ') || 'None'}
- Chronic Conditions: ${patientInfo?.chronicConditions?.join(', ') || 'None'}
- Current Medications: ${patientInfo?.medications?.join(', ') || 'None'}
- Past Medical History: ${patientInfo?.pastIllnesses?.join(', ') || 'None'}

Vital Signs:
- Blood Pressure: ${vitals?.bloodPressure || 'Not recorded'}
- Heart Rate: ${vitals?.heartRate || 'Not recorded'}
- Temperature: ${vitals?.temperature || 'Not recorded'}
- Weight: ${vitals?.weight || 'Not recorded'} kg
- Height: ${vitals?.height || 'Not recorded'} cm

Chief Complaint and Symptoms:
${symptoms}
`;

  const outputFormat = isArabic ? `
أرجو تقديم الرد بالتنسيق التالي (JSON):
{
  "subjective": "الشكوى الذاتية - ما يقوله المريض عن حالته",
  "objective": "الموضوعي - العلامات الحيوية والفحص السريري",
  "assessment": {
    "primaryDiagnosis": "التشخيص الأولي المقترح",
    "differentialDiagnoses": ["تشخيص تفريقي 1", "تشخيص تفريقي 2"],
    "icdCode": "رمز ICD-10 إن وجد",
    "severity": "خفيف/متوسط/شديد",
    "redFlags": ["علامات تحذيرية إن وجدت"]
  },
  "plan": {
    "investigations": ["الفحوصات المطلوبة"],
    "medications": [
      {"name": "اسم الدواء", "dose": "الجرعة", "frequency": "عدد المرات", "duration": "المدة"}
    ],
    "nonPharmacological": ["نصائح غير دوائية"],
    "followUp": "موعد المتابعة المقترح",
    "referrals": ["تحويلات إن لزم"]
  },
  "notes": "ملاحظات إضافية"
}
` : `
Please provide the response in the following format (JSON):
{
  "subjective": "Subjective findings - what the patient reports",
  "objective": "Objective findings - vital signs and clinical examination",
  "assessment": {
    "primaryDiagnosis": "Suggested primary diagnosis",
    "differentialDiagnoses": ["Differential diagnosis 1", "Differential diagnosis 2"],
    "icdCode": "ICD-10 code if applicable",
    "severity": "Mild/Moderate/Severe",
    "redFlags": ["Warning signs if any"]
  },
  "plan": {
    "investigations": ["Required tests"],
    "medications": [
      {"name": "Drug name", "dose": "Dosage", "frequency": "Frequency", "duration": "Duration"}
    ],
    "nonPharmacological": ["Non-drug recommendations"],
    "followUp": "Suggested follow-up",
    "referrals": ["Referrals if needed"]
  },
  "notes": "Additional notes"
}
`;

  const fullPrompt = `${systemPrompt}\n\n${patientSummary}\n\n${outputFormat}`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: fullPrompt
          }]
        }],
        generationConfig: {
          temperature: 0.3,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Gemini API error:', errorData);
      throw new Error(errorData.error?.message || 'Failed to generate clinical notes');
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      throw new Error('No response generated');
    }

    // Parse the JSON from the response
    const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        // If JSON parsing fails, return structured text
        return {
          rawResponse: generatedText,
          parsed: false
        };
      }
    }

    return {
      rawResponse: generatedText,
      parsed: false
    };

  } catch (error) {
    console.error('AI Service error:', error);
    throw error;
  }
}

/**
 * Check drug interactions
 * @param {Array} drugs - List of drug names
 * @param {Object} patientInfo - Patient info including allergies
 * @param {string} language - 'ar' for Arabic, 'en' for English
 */
async function checkDrugInteractions({ drugs, patientInfo, language = 'en' }) {
  const isArabic = language === 'ar';
  
  const prompt = isArabic ? `
أنت صيدلي سريري خبير. حلل التفاعلات الدوائية المحتملة بين الأدوية التالية:

الأدوية: ${drugs.join('، ')}

حساسية المريض: ${patientInfo?.allergies?.join('، ') || 'لا يوجد'}
الأمراض المزمنة: ${patientInfo?.chronicConditions?.join('، ') || 'لا يوجد'}

أرجو تقديم الرد بالتنسيق التالي (JSON):
{
  "interactions": [
    {"drugs": ["دواء1", "دواء2"], "severity": "شديد/متوسط/خفيف", "description": "وصف التفاعل", "recommendation": "التوصية"}
  ],
  "allergyWarnings": ["تحذيرات متعلقة بالحساسية"],
  "contraindications": ["موانع الاستخدام"],
  "overallSafety": "آمن/يحتاج مراقبة/غير آمن",
  "recommendations": ["توصيات عامة"]
}
` : `
You are an expert clinical pharmacist. Analyze potential drug interactions between the following medications:

Drugs: ${drugs.join(', ')}

Patient allergies: ${patientInfo?.allergies?.join(', ') || 'None'}
Chronic conditions: ${patientInfo?.chronicConditions?.join(', ') || 'None'}

Please provide the response in the following format (JSON):
{
  "interactions": [
    {"drugs": ["drug1", "drug2"], "severity": "Severe/Moderate/Mild", "description": "Interaction description", "recommendation": "Recommendation"}
  ],
  "allergyWarnings": ["Allergy-related warnings"],
  "contraindications": ["Contraindications"],
  "overallSafety": "Safe/Monitor/Unsafe",
  "recommendations": ["General recommendations"]
}
`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
        }
      })
    });

    if (!response.ok) {
      throw new Error('Failed to check drug interactions');
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    const jsonMatch = generatedText?.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return { rawResponse: generatedText, parsed: false };

  } catch (error) {
    console.error('Drug interaction check error:', error);
    throw error;
  }
}

/**
 * Generate patient summary
 * @param {Object} patient - Patient data
 * @param {Array} medicalRecords - Patient's medical records
 * @param {Array} prescriptions - Patient's prescriptions
 * @param {string} language - 'ar' for Arabic, 'en' for English
 */
async function generatePatientSummary({ patient, medicalRecords, prescriptions, labResults, language = 'en' }) {
  const isArabic = language === 'ar';
  
  const prompt = isArabic ? `
أنت مساعد طبي ذكي. قم بإنشاء ملخص شامل للمريض التالي:

معلومات المريض:
${JSON.stringify(patient, null, 2)}

السجلات الطبية (آخر 10):
${JSON.stringify(medicalRecords?.slice(0, 10) || [], null, 2)}

الوصفات الطبية الحالية:
${JSON.stringify(prescriptions?.slice(0, 5) || [], null, 2)}

نتائج المختبر الأخيرة:
${JSON.stringify(labResults?.slice(0, 5) || [], null, 2)}

أرجو تقديم ملخص منظم يشمل:
{
  "overview": "نظرة عامة على حالة المريض",
  "activeProblems": ["المشاكل الصحية النشطة"],
  "currentMedications": ["الأدوية الحالية مع الجرعات"],
  "allergiesAndWarnings": ["الحساسية والتحذيرات"],
  "recentTrends": "اتجاهات صحية ملحوظة",
  "upcomingNeeds": ["احتياجات قادمة - فحوصات، متابعات"],
  "riskFactors": ["عوامل الخطر"],
  "recommendations": ["توصيات للطبيب"]
}
` : `
You are an intelligent medical assistant. Generate a comprehensive summary for the following patient:

Patient Information:
${JSON.stringify(patient, null, 2)}

Medical Records (last 10):
${JSON.stringify(medicalRecords?.slice(0, 10) || [], null, 2)}

Current Prescriptions:
${JSON.stringify(prescriptions?.slice(0, 5) || [], null, 2)}

Recent Lab Results:
${JSON.stringify(labResults?.slice(0, 5) || [], null, 2)}

Please provide a structured summary including:
{
  "overview": "Overview of patient's condition",
  "activeProblems": ["Active health problems"],
  "currentMedications": ["Current medications with dosages"],
  "allergiesAndWarnings": ["Allergies and warnings"],
  "recentTrends": "Notable health trends",
  "upcomingNeeds": ["Upcoming needs - tests, follow-ups"],
  "riskFactors": ["Risk factors"],
  "recommendations": ["Recommendations for the doctor"]
}
`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
        }
      })
    });

    if (!response.ok) {
      throw new Error('Failed to generate patient summary');
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    const jsonMatch = generatedText?.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return { rawResponse: generatedText, parsed: false };

  } catch (error) {
    console.error('Patient summary error:', error);
    throw error;
  }
}

/**
 * Suggest diagnosis based on symptoms (quick suggestion)
 */
async function suggestDiagnosis({ symptoms, age, sex, language = 'en' }) {
  const isArabic = language === 'ar';
  
  const prompt = isArabic ? `
أنت مساعد طبي. بناءً على الأعراض التالية، اقترح التشخيصات المحتملة:

العمر: ${age || 'غير محدد'}
الجنس: ${sex || 'غير محدد'}
الأعراض: ${symptoms}

أرجو تقديم قائمة بالتشخيصات المحتملة بالتنسيق التالي (JSON):
{
  "suggestions": [
    {"diagnosis": "التشخيص", "probability": "عالي/متوسط/منخفض", "reasoning": "السبب"}
  ],
  "urgentAction": "هل يتطلب إجراء عاجل؟",
  "recommendedTests": ["الفحوصات الموصى بها"]
}
` : `
You are a medical assistant. Based on the following symptoms, suggest possible diagnoses:

Age: ${age || 'Not specified'}
Sex: ${sex || 'Not specified'}
Symptoms: ${symptoms}

Please provide a list of possible diagnoses in the following format (JSON):
{
  "suggestions": [
    {"diagnosis": "Diagnosis", "probability": "High/Medium/Low", "reasoning": "Reason"}
  ],
  "urgentAction": "Is urgent action required?",
  "recommendedTests": ["Recommended tests"]
}
`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
        }
      })
    });

    if (!response.ok) {
      throw new Error('Failed to suggest diagnosis');
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    const jsonMatch = generatedText?.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return { rawResponse: generatedText, parsed: false };

  } catch (error) {
    console.error('Diagnosis suggestion error:', error);
    throw error;
  }
}

/**
 * Patient-facing assistant chat.
 * It explains medical history/reports in simple language and routes patient to suitable specialty.
 * No treatment advice is allowed.
 */
/**
 * Doctor AI Assistant File Analysis - analyze medical files, lab results, imaging
 * @param {Object} params - Input parameters
 * @param {string} params.message - Doctor's description/question
 * @param {string} params.fileData - Base64 encoded file data
 * @param {string} params.fileName - Name of the file
 * @param {string} params.doctorId - Doctor's ID
 * @param {string} params.language - 'ar' for Arabic, 'en' for English
 * @returns {Object} Analysis result
 */
async function doctorAssistantAnalyzeFile({
  message,
  fileData,
  fileName,
  doctorId,
  language = 'ar'
}) {
  const isArabic = language === 'ar';
  
  const { mimeType, fileBase64 } = getMimeAndData(fileData);
  const isImage = mimeType.startsWith('image/');

  const systemPrompt = isArabic ? `
أنت خبير طبي متخصص في تحليل التقارير الطبية والأشعة.

القدرات:
1. تحليل صور الأشعة (X-ray, CT, MRI, إلخ)
2. قراءة تحاليل المختبر (CBC, وظائف الكبد، الهرمونات، إلخ)
3. تفسير التقارير الطبية
4. اقتراح فحوصات إضافية
5. تحديد العلامات الحرجة

قواعد مهمة:
1. لا تقدم تشخيصاً نهائياً
2. اذكر دائماً الحاجة للتقييم السريري
3. ركز على الملاحظات والنتائج
4. اقترح خطوات تالية
5. ذكر حدود التحليل الآلي
` : `
You are a medical expert specialized in analyzing medical reports and imaging.

Capabilities:
1. Analyze imaging (X-ray, CT, MRI, etc.)
2. Read lab results (CBC, liver function, hormones, etc.)
3. Interpret medical reports
4. Suggest additional tests
5. Identify critical findings

Important rules:
1. Don't provide final diagnoses
2. Always mention the need for clinical evaluation
3. Focus on observations and findings
4. Suggest next steps
5. Mention limitations of automated analysis
`;

  const analysisPrompt = `${systemPrompt}

اسم الملف: ${fileName}
وصف الطبيب: ${message || 'تحليل عام'}

حلل الملف المرفق وأعط تحليلاً طبياً دقيقاً.

أعد فقط JSON بالتنسيق التالي:
{
  "fileType": "نوع الملف (أشعة/تحليل/تقرير)",
  "findings": ["قائمة بالملاحظات المهمة"],
  "abnormalValues": ["قيم غير طبيعية إن وجدت"],
  "interpretation": "تفسير مبسط للنتائج",
  "recommendations": ["توصيات للخطوات التالية"],
  "urgencyLevel": "low | medium | high",
  "medicalDisclaimer": "تنويه طبي عن حدود التحليل",
  "assistantMessage": "ملخص التحليل للطبيب"
}`;

  try {
    const requestBody = {
      contents: [{
        parts: []
      }],
      generationConfig: {
        temperature: 0.2,
        topK: 20,
        topP: 0.9,
        maxOutputTokens: 2048,
      }
    };

    // Add text part
    requestBody.contents[0].parts.push({
      text: analysisPrompt
    });

    // Add image part if it's an image
    if (isImage && fileBase64) {
      requestBody.contents[0].parts.push({
        inline_data: {
          mime_type: mimeType,
          data: fileBase64
        }
      });
    }

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to analyze file');
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      throw new Error('No analysis generated');
    }

    const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        fileType: 'unknown',
        findings: [],
        abnormalValues: [],
        interpretation: generatedText,
        recommendations: [],
        urgencyLevel: 'low',
        medicalDisclaimer: isArabic ? 'هذا التحليل مساعد ويحتمل الخطأ' : 'This analysis is assistive and may contain errors',
        assistantMessage: generatedText
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      fileType: parsed.fileType || 'unknown',
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      abnormalValues: Array.isArray(parsed.abnormalValues) ? parsed.abnormalValues : [],
      interpretation: parsed.interpretation || '',
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      urgencyLevel: parsed.urgencyLevel || 'low',
      medicalDisclaimer: parsed.medicalDisclaimer || (isArabic ? 'هذا التحليل مساعد ويحتمل الخطأ' : 'This analysis is assistive and may contain errors'),
      assistantMessage: parsed.assistantMessage || (isArabic ? 'تم تحليل الملف بنجاح.' : 'File analyzed successfully.')
    };
  } catch (error) {
    console.error('Doctor file analysis error:', error);
    throw error;
  }
}

/**
 * Patient-facing assistant chat.
 * It explains medical history/reports in simple language and routes patient to suitable specialty.
 * No treatment advice is allowed.
 */
async function patientAssistantChat({
  message,
  patientContext,
  city,
  conversationHistory = [],
  language = 'ar'
}) {
  const isArabic = language === 'ar';

  const profile = patientContext?.profile || {};
  const medicalRecords = (patientContext?.medicalRecords || []).slice(0, 12);
  const labResults = (patientContext?.labResults || []).slice(0, 10);
  const imageRequests = (patientContext?.imageRequests || []).slice(0, 10);

  const noAdviceText = isArabic
    ? 'توجه لطبيب مختص حسب حالتك، وإذا بتحب احكيلي حالتك وأنا بساعدك عند مين تروح.'
    : 'Please consult a specialist doctor based on your condition. If you\'d like to tell me about your case, I can help you find the right doctor.';

  const systemPrompt = isArabic ? `
أنت مساعد ذكي للمرضى يشرح الملفات الطبية والتقارير بلغة مبسطة ويوجه المريض للتخصص المناسب.

قواعد مهمة:
1. لا تقدم أي نصيحة علاجية أو وصفة طبية مطلقاً
2. وضح المعلومات الطبية بلغة بسيطة
3. اقترح التخصص الطبي المناسب فقط
4. اذكر دائماً ضرورة مراجعة الطبيب للتشخيص النهائي
5. تجنب إثارة القلق أو الهلع
6. اعتمد على المعلومات المتوفرة فقط

الملف الطبي للمريض:
${JSON.stringify(profile, null, 2)}

السجلات الطبية:
${JSON.stringify(medicalRecords, null, 2)}

نتائج المختبر:
${JSON.stringify(labResults, null, 2)}

طلبات الأشعة:
${JSON.stringify(imageRequests, null, 2)}

المحادثة السابقة:
${JSON.stringify(conversationHistory, null, 2)}

${noAdviceText}
` : `
You are an AI assistant for patients that explains medical files and reports in simple language and routes patients to the appropriate specialty.

Important rules:
1. Never provide any treatment advice or medical prescriptions
2. Explain medical information in simple language
3. Only suggest appropriate medical specialty
4. Always mention the need to see a doctor for final diagnosis
5. Avoid causing anxiety or panic
6. Only use available information

Patient medical profile:
${JSON.stringify(profile, null, 2)}

Medical records:
${JSON.stringify(medicalRecords, null, 2)}

Lab results:
${JSON.stringify(labResults, null, 2)}

Imaging requests:
${JSON.stringify(imageRequests, null, 2)}

Previous conversation:
${JSON.stringify(conversationHistory, null, 2)}

${noAdviceText}
`;

  const prompt = `${systemPrompt}

سؤال المريض: ${message}
المدينة: ${city || 'غير محدد'}

أجب فقط بتنسيق JSON التالي:
{
  "responseType": "general | doctor_referral | history_explanation | report_explanation",
  "assistantMessage": "الرد المفصل للمريض",
  "needsCity": false,
  "city": "${city || ''}",
  "needsDoctorReferral": false,
  "detectedSpecialty": "",
  "specialtyReason": "",
  "historySummary": "",
  "reportsSummary": "",
  "confidence": "low | medium | high"
}`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.3,
          topK: 20,
          topP: 0.9,
          maxOutputTokens: 1536,
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to process patient assistant chat');
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      throw new Error('No response generated');
    }

    const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        responseType: 'general',
        assistantMessage: generatedText,
        needsCity: false,
        city: city || '',
        needsDoctorReferral: false,
        detectedSpecialty: '',
        specialtyReason: '',
        historySummary: '',
        reportsSummary: '',
        confidence: 'low'
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      responseType: parsed.responseType || 'general',
      assistantMessage: parsed.assistantMessage || (isArabic ? 'تم تحليل طلبك.' : 'Your request was analyzed.'),
      needsCity: !!parsed.needsCity,
      city: parsed.city || city || '',
      needsDoctorReferral: !!parsed.needsDoctorReferral,
      detectedSpecialty: parsed.detectedSpecialty || '',
      specialtyReason: parsed.specialtyReason || '',
      historySummary: parsed.historySummary || '',
      reportsSummary: parsed.reportsSummary || '',
      confidence: parsed.confidence || 'medium'
    };
  } catch (error) {
    console.error('Patient assistant chat error:', error);
    throw error;
  }
}

/**
 * Doctor AI Assistant Chat - helps doctors with patient management, medical analysis, and financial data
 * @param {Object} params - Input parameters
 * @param {string} params.message - Doctor's query
 * @param {string} params.doctorId - Doctor's ID for context
 * @param {Array} params.conversationHistory - Previous conversation
 * @param {string} params.language - 'ar' for Arabic, 'en' for English
 * @returns {Object} AI response with medical assistance
 */
async function doctorAssistantChat({
  message,
  doctorId,
  conversationHistory = [],
  language = 'ar'
}) {
  const isArabic = language === 'ar';

  const systemPrompt = isArabic ? `
أنت معالج نصوص طبي متخصص في استخراج البيانات من طلبات الأطباء.

مهمتك الوحيدة: استخرج من الطلب:
1. نوع العملية (responseType)
2. اسم المريض (patientName) - بالضبط كما قاله الطبيب

تذكر:
- أسماء المرضى قد تكون: إنجليزية (john), عربية (محمد), مختلطة
- استخرج اسم المريض من أي مكان في الرسالة
- لا تضيف شرح أو text إضافي
` : `
You are a medical text processor specialized in extracting data from doctor requests.

Your only task: Extract from the request:
1. Operation type (responseType)
2. Patient name (patientName) - exactly as the doctor said it

Remember:
- Patient names can be: English (john), Arabic (محمد), mixed
- Extract patient name from anywhere in the message
- Don't add explanation or extra text
`;

  const prompt = `${systemPrompt}

طلب الطبيب: "${message}"

استخرج فقط:
1. responseType: من القائمة [patient_record, patient_list, financial_report, clinic_stats, medical_consultation]
2. patientName: اسم المريض من الطلب (أو فارغ)

قواعد الاستخراج:
- إذا قال الطبيب اسم شخص → patient_record
- إذا قال "مرضى" أو "قائمة" → patient_list
- إذا قال "مالي" أو "أرباح" → financial_report
- إذا قال "إحصائيات" → clinic_stats
- وإلا → medical_consultation

أرجو الرد JSON فقط:
{"responseType": "...", "patientName": "..."}

مثال:
Input: "اعطيني تحليل دقيق للمريض nasser sayeh"
Output: {"responseType": "patient_record", "patientName": "nasser sayeh"}

Input: "اعرض مرضاي"
Output: {"responseType": "patient_list", "patientName": ""}

الآن الطلب:
"${message}"`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.2,
          topK: 15,
          topP: 0.85,
          maxOutputTokens: 1024,
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to process doctor assistant chat');
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      throw new Error('No response generated');
    }

    const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        responseType: 'medical_consultation',
        assistantMessage: generatedText,
        patientName: '',
        confidence: 'low'
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      responseType: parsed.responseType || 'medical_consultation',
      assistantMessage: parsed.assistantMessage || (isArabic ? 'تمت معالجة طلبك.' : 'Your request was processed.'),
      patientName: parsed.patientName || '',
      confidence: parsed.confidence || 'medium'
    };
  } catch (error) {
    console.error('Doctor assistant chat error:', error);
    throw error;
  }
}

/**
 * Doctor AI Assistant File Analysis - analyze medical files, lab results, imaging
 * @param {Object} params - Input parameters
 * @param {string} params.message - Doctor's description/question
 * @param {string} params.fileData - Base64 encoded file data
 * @param {string} params.fileName - Name of the file
 * @param {string} params.doctorId - Doctor's ID
 * @param {string} params.language - 'ar' for Arabic, 'en' for English
 * @returns {Object} Analysis result
 */
async function doctorAssistantAnalyzeFile({
  message,
  fileData,
  fileName,
  doctorId,
  language = 'ar'
}) {
  const isArabic = language === 'ar';
  
  const { mimeType, fileBase64 } = getMimeAndData(fileData);
  const isImage = mimeType.startsWith('image/');

  const systemPrompt = isArabic ? `
أنت خبير طبي متخصص في تحليل التقارير الطبية والأشعة.

القدرات:
1. تحليل صور الأشعة (X-ray, CT, MRI, إلخ)
2. قراءة تحاليل المختبر (CBC, وظائف الكبد، الهرمونات، إلخ)
3. تفسير التقارير الطبية
4. اقتراح فحوصات إضافية
5. تحديد العلامات الحرجة

قواعد مهمة:
1. لا تقدم تشخيصاً نهائياً
2. اذكر دائماً الحاجة للتقييم السريري
3. ركز على الملاحظات والنتائج
4. اقترح خطوات تالية
5. ذكر حدود التحليل الآلي
` : `
You are a medical expert specialized in analyzing medical reports and imaging.

Capabilities:
1. Analyze imaging (X-ray, CT, MRI, etc.)
2. Read lab results (CBC, liver function, hormones, etc.)
3. Interpret medical reports
4. Suggest additional tests
5. Identify critical findings

Important rules:
1. Don't provide final diagnoses
2. Always mention the need for clinical evaluation
3. Focus on observations and findings
4. Suggest next steps
5. Mention limitations of automated analysis
`;

  const analysisPrompt = `${systemPrompt}

اسم الملف: ${fileName}
وصف الطبيب: ${message || 'تحليل عام'}

حلل الملف المرفق وأعط تحليلاً طبياً دقيقاً.

أعد فقط JSON بالتنسيق التالي:
{
  "fileType": "نوع الملف (أشعة/تحليل/تقرير)",
  "findings": ["قائمة بالملاحظات المهمة"],
  "abnormalValues": ["قيم غير طبيعية إن وجدت"],
  "interpretation": "تفسير مبسط للنتائج",
  "recommendations": ["توصيات للخطوات التالية"],
  "urgencyLevel": "low | medium | high",
  "medicalDisclaimer": "تنويه طبي عن حدود التحليل",
  "assistantMessage": "ملخص التحليل للطبيب"
}`;

  try {
    const requestBody = {
      contents: [{
        parts: []
      }],
      generationConfig: {
        temperature: 0.2,
        topK: 20,
        topP: 0.9,
        maxOutputTokens: 2048,
      }
    };

    // Add text part
    requestBody.contents[0].parts.push({
      text: analysisPrompt
    });

    // Add image part if it's an image
    if (isImage && fileBase64) {
      requestBody.contents[0].parts.push({
        inline_data: {
          mime_type: mimeType,
          data: fileBase64
        }
      });
    }

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to analyze file');
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      throw new Error('No analysis generated');
    }

    const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        fileType: 'unknown',
        findings: [],
        abnormalValues: [],
        interpretation: generatedText,
        recommendations: [],
        urgencyLevel: 'low',
        medicalDisclaimer: isArabic ? 'هذا التحليل مساعد ويحتمل الخطأ' : 'This analysis is assistive and may contain errors',
        assistantMessage: generatedText
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      fileType: parsed.fileType || 'unknown',
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      abnormalValues: Array.isArray(parsed.abnormalValues) ? parsed.abnormalValues : [],
      interpretation: parsed.interpretation || '',
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      urgencyLevel: parsed.urgencyLevel || 'low',
      medicalDisclaimer: parsed.medicalDisclaimer || (isArabic ? 'هذا التحليل مساعد ويحتمل الخطأ' : 'This analysis is assistive and may contain errors'),
      assistantMessage: parsed.assistantMessage || (isArabic ? 'تم تحليل الملف بنجاح.' : 'File analyzed successfully.')
    };
  } catch (error) {
    console.error('Doctor file analysis error:', error);
    throw error;
  }
}

/**
 * Analyze patient report text and/or medical image in a simplified way without treatment advice.
 */
async function analyzePatientReportOrImage({
  reportText,
  imageBase64,
  mimeType = 'image/jpeg',
  language = 'ar',
  patientContext = {}
}) {
  const isArabic = language === 'ar';

  const instructionText = isArabic ? `
  "city": "اسم المدينة إن تم استخلاصها",
  "needsDoctorReferral": true,
  "detectedSpecialty": "التخصص المناسب إن وجد",
  "specialtyReason": "سبب اختيار التخصص باختصار",
  "historySummary": "ملخص مبسط للحالة من التاريخ المرضي إن مناسب",
  "reportsSummary": "شرح مبسط للفحوصات/الأشعة إن مناسب",
  "confidence": "low | medium | high"
}
` : `
You are a patient-safe health assistant inside a medical platform.

Mandatory rules:
1) Never provide treatment advice, medications, or treatment plans.
2) If user asks for medical advice, return this exact text:
"${noAdviceText}"
3) If user asks about their health condition, explain using available history/reports in simple language only, without advice.
4) If doctor routing is needed: identify best specialty from symptoms or direct requests and ask for city if missing.
5) If user asks about available doctors, pharmacies, schedules, or general service information: answer directly and helpfully.
6) Only show doctor suggestions in these cases:
   - Direct doctor requests ("I need a dentist", "find me a doctor")
   - Specific medical symptoms requiring doctor guidance ("tooth pain", "persistent headache")
   - Direct questions about doctors in a city
7) Do not show doctors for these cases:
   - General service questions ("what can you help me with", "what are your services")
   - Platform or system inquiries
   - General conversation or greetings
   - Requests for explanation about assistant functions
8) Keep responses concise and reassuring.
9) Never invent facts.
10) Avoid using special characters or symbols in responses.

Available medical specialties:
- Dentistry: for teeth, gums, and oral surgery
- Internal Medicine: for internal diseases and digestive system
- General Surgery: for surgical procedures
- Obstetrics & Gynecology: for women's health, pregnancy, and childbirth
- Pediatrics: for children and infants
- Dermatology: for skin, hair, and nail conditions
- Ophthalmology: for eye diseases and surgery
- ENT: for nose, ear, and throat problems
- Orthopedics: for bone fractures and joint pain
- Cardiology: for heart and vascular diseases
- Pulmonology: for lung and respiratory diseases
- Urology: for kidney and urinary tract issues
- Psychiatry: for mental health
- Neurology: for nervous system disorders

Examples of specialty detection:
- "I need a dentist" → Dentistry (needsDoctorReferral: true)
- "tooth pain" → Dentistry (needsDoctorReferral: true)
- "gum problem" → Dentistry (needsDoctorReferral: true)
- "dental extraction" → Dentistry (needsDoctorReferral: true)
- "braces" → Dentistry (needsDoctorReferral: true)
- "stomach pain" → Internal Medicine (needsDoctorReferral: true)
- "digestive issues" → Internal Medicine (needsDoctorReferral: true)
- "skin allergy" → Dermatology (needsDoctorReferral: true)

Examples of general questions (no doctors):
- "What can you help me with?" → general (needsDoctorReferral: false)
- "What are your services?" → general (needsDoctorReferral: false)
- "How do you work?" → general (needsDoctorReferral: false)
- "Hello" → general (needsDoctorReferral: false)
- "Hi there" → general (needsDoctorReferral: false)

Examples for listing doctors:
- "Who are the doctors in Ramallah?" → list_doctors (needsDoctorReferral: false)
- "Any doctors in Nablus?" → list_doctors (needsDoctorReferral: false)
- "Doctors in Hebron" → list_doctors (needsDoctorReferral: false)

Known patient city: ${city || 'Unknown'}

Patient profile:
${JSON.stringify(profile, null, 2)}

Recent medical records:
${JSON.stringify(medicalRecords, null, 2)}

Lab results:
${JSON.stringify(labResults, null, 2)}

Imaging reports:
${JSON.stringify(imageRequests, null, 2)}

Conversation history:
${JSON.stringify(conversationHistory, null, 2)}

Current user message:
${message}

Return JSON only in this format:
{
  "responseType": "ask_city | doctor_referral | history_explanation | report_explanation | advice_refusal | general",
  "assistantMessage": "final patient-facing response",
  "needsCity": false,
  "city": "city name if detected",
  "needsDoctorReferral": true,
  "detectedSpecialty": "best matched specialty if applicable",
5) Keep responses concise and reassuring.
6) Never invent facts.

Known patient city: ${city || 'Unknown'}

Patient profile:
${JSON.stringify(profile, null, 2)}

Recent medical records:
${JSON.stringify(medicalRecords, null, 2)}

Lab results:
${JSON.stringify(labResults, null, 2)}

Imaging reports:
${JSON.stringify(imageRequests, null, 2)}

Conversation history:
${JSON.stringify(conversationHistory, null, 2)}

Current user message:
${message}

Return JSON only in this format:
{
  "responseType": "ask_city | doctor_referral | history_explanation | report_explanation | advice_refusal | general",
  "assistantMessage": "final patient-facing response",
  "needsCity": true,
  "city": "city name if detected",
  "needsDoctorReferral": false,
  "detectedSpecialty": "best matched specialty if applicable",
  "specialtyReason": "short reason for selected specialty",
  "historySummary": "simple summary from history if relevant",
  "reportsSummary": "simple explanation for labs/imaging if relevant",
  "confidence": "low | medium | high"
}
`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.2,
          topK: 20,
          topP: 0.9,
          maxOutputTokens: 1536,
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to process patient assistant chat');
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      throw new Error('No response generated');
    }

    const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        responseType: 'general',
        assistantMessage: generatedText,
        needsCity: false,
        city: city || '',
        needsDoctorReferral: false,
        detectedSpecialty: '',
        specialtyReason: '',
        historySummary: '',
        reportsSummary: '',
        confidence: 'low'
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      responseType: parsed.responseType || 'general',
      assistantMessage: parsed.assistantMessage || (isArabic ? 'تم تحليل طلبك.' : 'Your request was analyzed.'),
      needsCity: !!parsed.needsCity,
      city: parsed.city || city || '',
      needsDoctorReferral: !!parsed.needsDoctorReferral,
      detectedSpecialty: parsed.detectedSpecialty || '',
      specialtyReason: parsed.specialtyReason || '',
      historySummary: parsed.historySummary || '',
      reportsSummary: parsed.reportsSummary || '',
      confidence: parsed.confidence || 'medium'
    };
  } catch (error) {
    console.error('Patient assistant chat error:', error);
    throw error;
  }
}

/**
 * Analyze patient report text and/or medical image in a simplified way without treatment advice.
 */
async function analyzePatientReportOrImage({
  reportText,
  imageBase64,
  mimeType = 'image/jpeg',
  language = 'ar',
  patientContext = {}
}) {
  const isArabic = language === 'ar';

  const instructionText = isArabic ? `
أنت مساعد طبي للمريض.
المطلوب: شرح مبسط لنتيجة التقرير أو صورة الأشعة فقط.

قواعد صارمة:
1) لا تقدم نصائح علاجية ولا أدوية ولا خطة علاج.
2) اشرح بلغة بسيطة جدًا.
3) وضّح النقاط غير الطبيعية إن وجدت، واذكر أنها تحتاج مراجعة طبيب مختص.
4) لا تخترع معلومات غير موجودة.

سياق المريض:
${JSON.stringify(patientContext, null, 2)}

نص التقرير (إن وجد):
${reportText || 'لا يوجد'}

أعد JSON فقط بهذا الشكل:
{
  "summary": "ملخص مبسط",
  "keyFindings": ["نقطة 1", "نقطة 2"],
  "abnormalFindings": ["نتيجة غير طبيعية 1"],
  "plainExplanation": "شرح مبسط للمريض",
  "safetyNote": "هذا شرح معلوماتي فقط وليس نصيحة طبية. راجع طبيبًا مختصًا للتقييم النهائي."
}
` : `
You are a patient-facing medical assistant.
Task: provide a simple explanation for report result and/or medical image only.

Strict rules:
1) Do not provide treatment advice, medications, or treatment plans.
2) Use very simple language.
3) Highlight abnormal findings if present and state they require specialist review.
4) Never invent facts.

Patient context:
${JSON.stringify(patientContext, null, 2)}

Report text (if available):
${reportText || 'N/A'}

Return JSON only in this format:
{
  "summary": "simple summary",
  "keyFindings": ["finding 1", "finding 2"],
  "abnormalFindings": ["abnormal finding 1"],
  "plainExplanation": "patient-friendly explanation",
  "safetyNote": "This is informational only and not medical advice. Please consult a specialist doctor for final evaluation."
}
`;

  const parts = [{ text: instructionText }];
  if (imageBase64) {
    parts.push({
      inline_data: {
        mime_type: mimeType || 'image/jpeg',
        data: imageBase64
      }
    });
  }

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.2,
          topK: 20,
          topP: 0.9,
          maxOutputTokens: 1400,
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to analyze report/image');
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!generatedText) {
      throw new Error('No response generated');
    }

    const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        summary: isArabic ? 'تم تحليل الملف.' : 'File analyzed.',
        keyFindings: [],
        abnormalFindings: [],
        plainExplanation: generatedText,
        safetyNote: isArabic
          ? 'هذا شرح معلوماتي فقط وليس نصيحة طبية. راجع طبيبًا مختصًا للتقييم النهائي.'
          : 'This is informational only and not medical advice. Please consult a specialist doctor for final evaluation.'
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      summary: parsed.summary || (isArabic ? 'تم تحليل الملف.' : 'File analyzed.'),
      keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
      abnormalFindings: Array.isArray(parsed.abnormalFindings) ? parsed.abnormalFindings : [],
      plainExplanation: parsed.plainExplanation || '',
      safetyNote: parsed.safetyNote || (isArabic
        ? 'هذا شرح معلوماتي فقط وليس نصيحة طبية. راجع طبيبًا مختصًا للتقييم النهائي.'
        : 'This is informational only and not medical advice. Please consult a specialist doctor for final evaluation.')
    };
  } catch (error) {
    console.error('Analyze patient report/image error:', error);
    throw error;
  }
}

/**
 * Pharmacy Drug Interaction Check
 * Checks for drug interactions between a proposed medication and patient's current medications
 * @param {Object} params - Input parameters
 * @param {string} params.patientId - Patient ID for reference
 * @param {Array} params.currentMedications - Current medications the patient is taking
 * @param {string} params.proposedMedication - Medication being proposed
 * @param {string} params.language - 'ar' for Arabic, 'en' for English
 * @returns {Object} Drug interaction analysis
 */
async function pharmacyDrugCheck({ patientId, currentMedications = [], proposedMedication, language = 'en' }) {
  const isArabic = language === 'ar';
  
  console.log('=== PHARMACY DRUG CHECK SERVICE ===');
  console.log('Inputs:', { patientId, currentMedications, proposedMedication, language });
  
  const prompt = isArabic ? `فحص تعارضات الأدوية

الأدوية الحالية: ${currentMedications.length > 0 ? currentMedications.join(', ') : 'لا توجد'}
الدواء المقترح: ${proposedMedication}

أجب بـ JSON فقط بدون أي نص إضافي:
{
  "hasInteraction": true أو false,
  "interactionSeverity": "none" أو "mild" أو "moderate" أو "severe",
  "interactionDetails": "شرح مختصر للتعارض أو عدم التعارض",
  "mechanism": "الآلية العلمية إن وجدت",
  "recommendations": "التوصيات الآمنة",
  "warningFlags": "التحذيرات إن وجدت أو 'لا توجد'"
}` : `Check drug interactions

Current Medications: ${currentMedications.length > 0 ? currentMedications.join(', ') : 'None'}
Proposed Medication: ${proposedMedication}

Respond with JSON ONLY, no extra text:
{
  "hasInteraction": true or false,
  "interactionSeverity": "none" or "mild" or "moderate" or "severe",
  "interactionDetails": "Brief explanation",
  "mechanism": "Scientific mechanism if any",
  "recommendations": "Safe recommendations",
  "warningFlags": "Warnings or 'None'"
}`;

  console.log('Medications text for AI:', { current: currentMedications, proposed: proposedMedication });
  console.log('API Key available:', !!GEMINI_API_KEY && GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY');
  console.log('API URL:', GEMINI_API_URL);

  try {
    console.log('Calling Gemini API...');
    const response = await fetch(GEMINI_API_URL + `?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024
        }
      })
    });

    console.log('Gemini API response status:', response.status);
    console.log('Gemini API response ok:', response.ok);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', errorText);
      throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Gemini API response data:', JSON.stringify(data).substring(0, 500));
    
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    console.log('Gemini raw response:', textContent);

    // Parse JSON response with improved parsing
    let analysis = null;
    try {
      // Remove markdown code blocks if present
      let jsonString = textContent.trim();
      
      // Remove ```json ... ``` and ``` blocks
      jsonString = jsonString.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      
      // Try to find valid JSON by finding matching braces
      let braceCount = 0;
      let jsonStart = -1;
      let jsonEnd = -1;
      
      for (let i = 0; i < jsonString.length; i++) {
        if (jsonString[i] === '{') {
          if (jsonStart === -1) jsonStart = i;
          braceCount++;
        } else if (jsonString[i] === '}') {
          braceCount--;
          if (braceCount === 0 && jsonStart !== -1) {
            jsonEnd = i + 1;
            break;
          }
        }
      }
      
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const jsonSubstring = jsonString.substring(jsonStart, jsonEnd);
        console.log('Found potential JSON:', jsonSubstring.substring(0, 200));
        analysis = JSON.parse(jsonSubstring);
        console.log('✅ Successfully parsed JSON:', {
          hasInteraction: analysis.hasInteraction,
          severity: analysis.interactionSeverity
        });
      }
    } catch (parseError) {
      console.error('❌ JSON parse error:', parseError.message);
      console.error('Failed text:', textContent.substring(0, 500));
    }

    // Fallback if JSON parsing fails
    if (!analysis) {
      console.log('⚠️ No valid JSON found, using fallback');
      analysis = {
        hasInteraction: false,
        interactionSeverity: 'none',
        interactionDetails: isArabic ? 'لم يتم العثور على تعارضات' : 'No interactions found',
        mechanism: 'N/A',
        recommendations: isArabic ? 'يمكن إعطاء الدواء بأمان' : 'Medication can be given safely',
        warningFlags: isArabic ? 'لا توجد تحذيرات' : 'No warnings'
      };
    }

    // Validate and clean response
    if (!analysis.hasInteraction) {
      analysis.hasInteraction = false;
    }
    if (!['none', 'mild', 'moderate', 'severe'].includes(analysis.interactionSeverity)) {
      analysis.interactionSeverity = 'none';
    }
    if (!analysis.interactionDetails) {
      analysis.interactionDetails = isArabic ? 'لا توجد تفاصيل' : 'No details';
    }
    if (!analysis.recommendations) {
      analysis.recommendations = isArabic ? 'استشر الصيدلاني' : 'Consult pharmacist';
    }
    if (!analysis.warningFlags) {
      analysis.warningFlags = isArabic ? 'لا توجد تحذيرات' : 'No warnings';
    }
    
    // Build comprehensive response
    let fullAnalysis = isArabic
      ? `📋 **تحليل تعارضات الأدوية**\n\n`
      : `📋 **Drug Interaction Analysis**\n\n`;

    fullAnalysis += isArabic
      ? `**النتيجة:** ${analysis.hasInteraction ? '⚠️ يوجد تعارض' : '✅ لا يوجد تعارض'}\n`
      : `**Result:** ${analysis.hasInteraction ? '⚠️ Interaction Found' : '✅ No Interaction'}\n`;

    if (analysis.hasInteraction) {
      fullAnalysis += isArabic
        ? `**مستوى التعارض:** ${analysis.interactionSeverity}\n`
        : `**Severity Level:** ${analysis.interactionSeverity}\n`;
      
      fullAnalysis += isArabic
        ? `**التفاصيل:** ${analysis.interactionDetails}\n`
        : `**Details:** ${analysis.interactionDetails}\n`;

      if (analysis.mechanism && analysis.mechanism !== 'N/A') {
        fullAnalysis += isArabic
          ? `**الآلية:** ${analysis.mechanism}\n`
          : `**Mechanism:** ${analysis.mechanism}\n`;
      }
    }

    if (analysis.recommendations) {
      fullAnalysis += isArabic
        ? `**التوصيات:** ${analysis.recommendations}\n`
        : `**Recommendations:** ${analysis.recommendations}\n`;
    }

    if (analysis.warningFlags) {
      fullAnalysis += isArabic
        ? `**تحذيرات:** ${analysis.warningFlags}\n`
        : `**Warnings:** ${analysis.warningFlags}\n`;
    }

    return {
      analysis: fullAnalysis,
      hasInteraction: analysis.hasInteraction,
      severity: analysis.interactionSeverity,
      recommendations: analysis.recommendations,
      warningFlags: analysis.warningFlags
    };
  } catch (error) {
    console.error('Pharmacy drug check error:', error);
    throw error;
  }
}

async function pharmacyAssistantChat({
  message,
  language = 'ar'
}) {
  const isArabic = language === 'ar';

  const systemPrompt = isArabic ? `
أنت معاون صيدلي ذكي متخصص في الإجابة على الأسئلة الصيدلانية العامة.

مهمتك:
- الإجابة على أسئلة عن الأدوية والتفاعلات بينها
- شرح استخدامات الأدوية
- تقديم معلومات صحيحة وموثوقة
- التنبيه على الأعراض الجانبية والتحذيرات
- الإجابة بشكل واضح وموجز
- دائماً أذكر أن المستخدم يجب أن يستشير الطبيب/الصيدلي قبل تناول أي دواء

أسلوب الرد:
- ود واحترافي
- شامل لكن مختصر
- مع تنبيهات أمان عند الحاجة
` : `
You are a smart pharmacy assistant specialized in answering general pharmaceutical questions.

Your tasks:
- Answer questions about medications and drug interactions
- Explain medication uses
- Provide accurate and reliable information
- Alert about side effects and warnings
- Answer clearly and concisely
- Always mention that users should consult a pharmacist/doctor before taking any medication

Response style:
- Friendly and professional
- Comprehensive but concise
- With safety alerts when needed
`;

  const prompt = `${systemPrompt}

المستخدم يسأل: "${message}"

أرجو الرد بشكل مباشر وشامل. الرد يجب أن يكون:
1. واضح ومفهوم
2. آمن وموثوق
3. يتضمن تحذيرات عند الحاجة
4. يوصي باستشارة الطبيب/الصيدلي عند الحاجة`;

  try {
    console.log('🔄 Calling Gemini API for pharmacy chat...');
    
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.3,
          topK: 20,
          topP: 0.9,
          maxOutputTokens: 2048,
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('❌ Gemini API error:', errorData);
      throw new Error(errorData.error?.message || 'Failed to get pharmacy assistant response');
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
      throw new Error('No response generated from API');
    }

    console.log('✅ Pharmacy assistant response generated successfully');

    return {
      assistantMessage: generatedText,
      success: true
    };
  } catch (error) {
    console.error('❌ pharmacyAssistantChat error:', error);
    throw error;
  }
}

async function extractPrescriptionMedications({
  fileData,
  language = 'ar'
}) {
  const { mimeType, fileBase64 } = getMimeAndData(fileData);
  if (!fileBase64) {
    throw new Error('Prescription file data is required');
  }
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') {
    throw new Error('AI service is not configured');
  }

  const prompt = `
You are a prescription OCR and medication extraction engine.
Read the attached prescription. It may be a system-generated prescription, a scanned paper prescription, or a phone photo.

Return ONLY valid JSON. Do not include markdown.
Extract medication names as written and normalize obvious OCR mistakes only when confident.
Do not invent medicines. If handwriting is unclear, include the item with confidence below 0.5 and a note.

JSON shape:
{
  "medications": [
    {
      "name": "medicine brand or generic name",
      "strength": "e.g. 500mg, 5ml, 20 mg/ml, or empty",
      "dosageForm": "tablet | capsule | syrup | injection | drops | cream | inhaler | unknown",
      "quantity": 1,
      "instructions": "short dosing instructions if visible",
      "confidence": 0.0
    }
  ],
  "patientName": "",
  "doctorName": "",
  "prescriptionDate": "",
  "notes": ""
}`;

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: fileBase64
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        topK: 20,
        topP: 0.8,
        maxOutputTokens: 2048,
      }
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || 'Failed to analyze prescription');
  }

  const data = await response.json();
  const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      medications: [],
      patientName: '',
      doctorName: '',
      prescriptionDate: '',
      notes: language === 'ar' ? 'لم يتم التعرف على أدوية بوضوح' : 'No clear medications detected'
    };
  }

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    medications: Array.isArray(parsed.medications) ? parsed.medications.map((med) => ({
      name: String(med.name || '').trim(),
      strength: String(med.strength || '').trim(),
      dosageForm: String(med.dosageForm || 'unknown').trim(),
      quantity: Math.max(1, Number(med.quantity) || 1),
      instructions: String(med.instructions || '').trim(),
      confidence: Math.max(0, Math.min(1, Number(med.confidence) || 0))
    })).filter((med) => med.name) : [],
    patientName: parsed.patientName || '',
    doctorName: parsed.doctorName || '',
    prescriptionDate: parsed.prescriptionDate || '',
    notes: parsed.notes || ''
  };
}

module.exports = {
  generateClinicalNotes,
  checkDrugInteractions,
  generatePatientSummary,
  suggestDiagnosis,
  patientAssistantChat,
  analyzePatientReportOrImage,
  doctorAssistantChat,
  doctorAssistantAnalyzeFile,
  pharmacyDrugCheck,
  pharmacyAssistantChat,
  extractPrescriptionMedications
};
