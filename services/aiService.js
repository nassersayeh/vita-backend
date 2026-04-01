// AI Clinical Assistant Service using Google Gemini (Free Tier)
// Supports both Arabic and English

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

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

module.exports = {
  generateClinicalNotes,
  checkDrugInteractions,
  generatePatientSummary,
  suggestDiagnosis
};
