const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SPECIALTIES = [
  { name: 'طب الأسنان', pattern: /سن|أسنان|اسنان|ضرس|لثة|تقويم|tooth|teeth|dental|gum/i },
  { name: 'القلبية', pattern: /قلب|صدر.*خفقان|خفقان|ضغط الدم|cardiac|heart|palpitation/i },
  { name: 'الجلدية', pattern: /جلد|طفح|حكة|حبوب|شعر|أظافر|dermat|rash|itch|skin/i },
  { name: 'العيون', pattern: /عين|نظر|رؤية|عيون|eye|vision|ophthalm/i },
  { name: 'الأنف والأذن والحنجرة', pattern: /أنف|انف|أذن|اذن|حنجرة|لوز|جيوب|سمع|ear|nose|throat|sinus|ent/i },
  { name: 'العظام', pattern: /عظم|مفصل|ركبة|ظهر|كتف|كسر|عضلات|orthop|joint|bone|back pain/i },
  { name: 'الأطفال', pattern: /طفل|رضيع|ابني|ابنتي|pediatric|child|infant/i },
  { name: 'النساء والتوليد', pattern: /حمل|دورة|رحم|مبيض|نسائية|ولادة|pregnan|period|gynec|obstet/i },
  { name: 'البولية', pattern: /بول|كلية|كلى|مثانة|بروستات|urine|kidney|bladder|urolog/i },
  { name: 'الأعصاب', pattern: /أعصاب|صداع|شقيقة|دوخة|تنميل|تشنج|migraine|headache|neurolog|numb/i },
  { name: 'الصدرية', pattern: /تنفس|رئة|سعال|ربو|ضيق نفس|lung|cough|asthma|breath/i },
  { name: 'الطب النفسي', pattern: /قلق|اكتئاب|نفسي|نوم|هلع|anxiety|depress|psychi|panic/i },
  { name: 'الجراحة العامة', pattern: /فتق|زائدة|مرارة|جراحة|عملية|hernia|appendix|surgery/i },
  { name: 'الباطنة', pattern: /معدة|بطن|سكر|غدة|كبد|قولون|هضم|حرارة|تعب|stomach|abdomen|diabet|liver|digest|fever|fatigue/i },
];

const clean = (value) => {
  if (value === null || value === undefined || value === '') return undefined;
  if (Array.isArray(value)) {
    const items = value.map(clean).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value instanceof Date) return value.toISOString();
  if (value?._bsontype === 'ObjectId') return String(value);
  if (typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if ([
        '_id', '__v', 'password', 'resetCode', 'createdBy', 'lastEditedBy',
        'patientId', 'doctorId', 'labId', 'clinicId', 'requestedBy', 'approvedBy'
      ].includes(key)) continue;
      const cleaned = clean(item);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return Object.keys(result).length ? result : undefined;
  }
  return value;
};

const calculateAge = (birthdate) => {
  if (!birthdate) return null;
  const birth = new Date(birthdate);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (
    now.getMonth() < birth.getMonth()
    || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
  ) age -= 1;
  return age;
};

function buildPatientContext(patientContext = {}) {
  const profile = clean(patientContext.profile) || {};
  const age = calculateAge(profile.birthdate);
  const height = Number(profile.height);
  const weight = Number(profile.weight);
  const bmi = height > 0 && weight > 0
    ? Number((weight / ((height / 100) ** 2)).toFixed(1))
    : null;

  return clean({
    profile: { ...profile, age, bmi },
    medicalRecords: patientContext.medicalRecords || [],
    legacyMedicalRecords: patientContext.legacyRecords || [],
    prescriptions: patientContext.prescriptions || [],
    labRequestsAndResults: patientContext.labResults || [],
    imagingRequestsAndResults: patientContext.imageRequests || [],
  }) || {};
}

function dataCounts(context) {
  return {
    medicalRecords: context.medicalRecords?.length || 0,
    legacyMedicalRecords: context.legacyMedicalRecords?.length || 0,
    prescriptions: context.prescriptions?.length || 0,
    labResults: context.labRequestsAndResults?.length || 0,
    imagingResults: context.imagingRequestsAndResults?.length || 0,
  };
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .replace(/\*\*/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .trim();
}

async function generatePlainText(prompt, fallback) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: attempt === 0
              ? prompt
              : `${prompt}\nأعد الإجابة من البداية. يجب أن تكون مكتملة وأقصر، ولا تنهها في منتصف جملة.`
          }]
        }],
        generationConfig: {
          temperature: 0.15,
          topP: 0.85,
          maxOutputTokens: 4096,
        }
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || 'Patient AI request failed');
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const text = sanitizeText(candidate?.content?.parts?.map((part) => part.text || '').join(''));
    const finishReason = candidate?.finishReason || '';
    console.log('🤖 Patient AI plain response:', {
      attempt: attempt + 1,
      finishReason: finishReason || 'unknown',
      outputLength: text.length,
    });

    if (text && (!finishReason || finishReason === 'STOP')) return text;
  }
  return fallback;
}

function factualFallback(context, language) {
  const isArabic = language === 'ar';
  const profile = context.profile || {};
  const counts = dataCounts(context);
  const values = [];
  if (profile.age !== undefined) values.push(isArabic ? `العمر: ${profile.age} سنة` : `Age: ${profile.age}`);
  if (profile.height) values.push(isArabic ? `الطول: ${profile.height} سم` : `Height: ${profile.height} cm`);
  if (profile.weight) values.push(isArabic ? `الوزن: ${profile.weight} كغم` : `Weight: ${profile.weight} kg`);
  if (profile.bmi) values.push(`BMI: ${profile.bmi}`);
  if (profile.bloodType) values.push(isArabic ? `فصيلة الدم: ${profile.bloodType}` : `Blood type: ${profile.bloodType}`);

  return isArabic
    ? `المعلومات المسجلة: ${values.join('، ') || 'لا توجد قياسات أساسية مسجلة'}.\nالسجلات المتوفرة: ${counts.medicalRecords + counts.legacyMedicalRecords} سجل طبي، ${counts.prescriptions} وصفة، ${counts.labResults} طلب فحص، و${counts.imagingResults} تقرير أشعة. راجع تفاصيل الملفات مع طبيبك للتقييم النهائي.`
    : `Recorded information: ${values.join(', ') || 'No basic measurements recorded'}.\nAvailable records: ${counts.medicalRecords + counts.legacyMedicalRecords} medical records, ${counts.prescriptions} prescriptions, ${counts.labResults} lab requests, and ${counts.imagingResults} imaging reports. Review the details with your doctor for final evaluation.`;
}

const displayValue = (value) => {
  if (value === undefined || value === null || value === '') return '';
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join('، ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => {
        const displayed = displayValue(item);
        return displayed ? `${key}: ${displayed}` : '';
      })
      .filter(Boolean)
      .join('، ');
  }
  return String(value);
};

const recordDate = (item = {}) => {
  const value = item.date || item.appointmentDate || item.completedDate || item.requestDate || item.createdAt;
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
};

function buildCompleteSummary(context, language) {
  const isArabic = language === 'ar';
  const profile = context.profile || {};
  const sections = [];
  const addSection = (title, lines) => {
    const valid = lines.filter(Boolean);
    sections.push(`${title}\n${valid.length ? valid.join('\n') : (isArabic ? 'لا توجد بيانات مسجلة.' : 'No recorded data.')}`);
  };

  addSection(isArabic ? 'المعلومات الأساسية' : 'Basic information', [
    profile.fullName && (isArabic ? `الاسم: ${profile.fullName}` : `Name: ${profile.fullName}`),
    profile.age !== undefined && (isArabic ? `العمر: ${profile.age} سنة` : `Age: ${profile.age}`),
    profile.sex && (isArabic ? `الجنس: ${profile.sex}` : `Sex: ${profile.sex}`),
    profile.bloodType && (isArabic ? `فصيلة الدم: ${profile.bloodType}` : `Blood type: ${profile.bloodType}`),
    profile.height && (isArabic ? `الطول: ${profile.height} سم` : `Height: ${profile.height} cm`),
    profile.weight && (isArabic ? `الوزن: ${profile.weight} كغم` : `Weight: ${profile.weight} kg`),
    profile.bmi && `BMI: ${profile.bmi}`,
    profile.bloodPressure && (isArabic ? `ضغط الدم المسجل: ${profile.bloodPressure}` : `Recorded blood pressure: ${profile.bloodPressure}`),
    profile.bloodSugar && (isArabic ? `سكر الدم المسجل: ${profile.bloodSugar}` : `Recorded blood sugar: ${profile.bloodSugar}`),
  ]);

  addSection(isArabic ? 'التاريخ الصحي' : 'Health history', [
    displayValue(profile.chronicConditions) && `${isArabic ? 'الأمراض المزمنة' : 'Chronic conditions'}: ${displayValue(profile.chronicConditions)}`,
    profile.chronicDiseasesText && `${isArabic ? 'تفاصيل الأمراض المزمنة' : 'Chronic disease details'}: ${profile.chronicDiseasesText}`,
    displayValue(profile.pastIllnesses) && `${isArabic ? 'الأمراض السابقة' : 'Past illnesses'}: ${displayValue(profile.pastIllnesses)}`,
    profile.previousDiseases && `${isArabic ? 'تاريخ مرضي إضافي' : 'Additional history'}: ${profile.previousDiseases}`,
    profile.surgeriesText && `${isArabic ? 'العمليات' : 'Surgeries'}: ${profile.surgeriesText}`,
    displayValue(profile.allergies) && `${isArabic ? 'الحساسيات' : 'Allergies'}: ${displayValue(profile.allergies)}`,
    profile.drugAllergiesText && `${isArabic ? 'حساسية الأدوية' : 'Drug allergies'}: ${profile.drugAllergiesText}`,
    profile.foodAllergiesText && `${isArabic ? 'حساسية الطعام' : 'Food allergies'}: ${profile.foodAllergiesText}`,
    displayValue(profile.medications) && `${isArabic ? 'الأدوية الحالية' : 'Current medications'}: ${displayValue(profile.medications)}`,
  ]);

  const modernRecords = (context.medicalRecords || []).map((record, index) => {
    const details = [
      record.diagnosis || record.preliminaryDiagnosis,
      record.chiefComplaint,
      record.examinationFindings || record.clinicalExamination,
      record.investigations,
      record.notes,
    ].map(displayValue).filter(Boolean);
    return `${index + 1}. ${recordDate(record) || (isArabic ? 'دون تاريخ' : 'No date')}: ${details.join(' — ') || (isArabic ? 'سجل دون تفاصيل نصية' : 'Record without text details')}`;
  });
  const legacyRecords = (context.legacyMedicalRecords || []).map((record, index) => {
    const details = [record.issueDescription, record.treatmentPlan, record.ePrescription].map(displayValue).filter(Boolean);
    return `${modernRecords.length + index + 1}. ${recordDate(record) || (isArabic ? 'دون تاريخ' : 'No date')}: ${details.join(' — ')}`;
  });
  addSection(isArabic ? 'السجلات والزيارات الطبية' : 'Medical records and visits', [...modernRecords, ...legacyRecords]);

  addSection(isArabic ? 'الوصفات الطبية' : 'Prescriptions', (context.prescriptions || []).map((prescription, index) => {
    const products = (prescription.products || []).map((product) =>
      [product.name, product.dose, product.instructions].filter(Boolean).join(' - ')
    ).filter(Boolean);
    return `${index + 1}. ${recordDate(prescription) || (isArabic ? 'دون تاريخ' : 'No date')}: ${products.join('، ') || displayValue(prescription.notes) || (isArabic ? 'لا توجد أدوية مفصلة' : 'No detailed medications')}`;
  }));

  addSection(isArabic ? 'الفحوصات المخبرية' : 'Laboratory tests', (context.labRequestsAndResults || []).map((request, index) => {
    const results = (request.results || []).map((result) => {
      const name = result.testName || result.name || result.testId?.name || request.testName || '';
      return [name, result.result, result.normalRange && `${isArabic ? 'الطبيعي' : 'normal'}: ${result.normalRange}`, result.unit].filter(Boolean).join(' ');
    }).filter(Boolean);
    return `${index + 1}. ${recordDate(request) || (isArabic ? 'دون تاريخ' : 'No date')} (${request.status || ''}): ${results.join('، ') || displayValue(request.notes) || (isArabic ? 'لا توجد نتيجة نصية مسجلة' : 'No textual result recorded')}`;
  }));

  addSection(isArabic ? 'الأشعة والتصوير' : 'Imaging', (context.imagingRequestsAndResults || []).map((request, index) => {
    const details = [
      request.imageType,
      request.bodyPart,
      request.findings,
      request.radiologistNotes,
      request.notes,
    ].map(displayValue).filter(Boolean);
    return `${index + 1}. ${recordDate(request) || (isArabic ? 'دون تاريخ' : 'No date')} (${request.status || ''}): ${details.join(' — ') || (isArabic ? 'لا توجد نتيجة نصية مسجلة' : 'No textual result recorded')}`;
  }));

  sections.push(isArabic
    ? 'هذا ملخص للمعلومات المسجلة في منصة Vita، وليس تشخيصًا جديدًا. يمكنني شرح أي بند منه إذا سألتني عنه.'
    : 'This summarizes information recorded in Vita and is not a new diagnosis. Ask me to explain any item.');
  return sections.join('\n\n');
}

function isSummaryRequest(message) {
  return /ملخص|لخص|حالتي الصحية|ملفي الصحي|health summary|summari[sz]e|medical file/i.test(message);
}

function isDoctorRequest(message, conversationHistory) {
  const direct = /(?:بدي|أريد|اريد|دلني|اعطيني|ابحث).*(?:طبيب|دكتور)|(?:طبيب|دكتور).*(?:مناسب|مختص)|find.*doctor|need.*doctor/i.test(message);
  const assistantAskedSymptoms = (conversationHistory || []).slice(-2).some(
    (item) => item.role === 'assistant' && /اكتب لي الأعراض|ما هي الأعراض|tell me your symptoms/i.test(item.text || '')
  );
  return direct || assistantAskedSymptoms;
}

function isPharmacyRequest(message) {
  return /صيدلي|صيدلية|صيدليات|pharmacy|pharmacies|pharmacist/i.test(message);
}

function conversationText(message, conversationHistory) {
  return [
    message,
    ...(conversationHistory || [])
      .filter((item) => item.role === 'user')
      .slice(-4)
      .map((item) => item.text || ''),
  ].join(' ');
}

function containsActualSymptoms(message, conversationHistory) {
  const combined = conversationText(message, conversationHistory);
  if (SPECIALTIES.some(({ pattern }) => pattern.test(combined))) return true;
  return /عندي|أشعر|بعاني|يؤلمني|وجع|ألم|اعراضي|أعراضي|صداع|دوخة|symptom|i have|i feel|pain|ache/i.test(combined);
}

function detectSpecialty(message, context, conversationHistory) {
  const combined = conversationText(message, conversationHistory);
  const direct = SPECIALTIES.find(({ pattern }) => pattern.test(combined));
  if (direct) return direct.name;

  const diagnoses = JSON.stringify({
    records: context.medicalRecords,
    legacy: context.legacyMedicalRecords,
  });
  return SPECIALTIES.find(({ pattern }) => pattern.test(diagnoses))?.name || 'الباطنة';
}

async function patientAssistantChat({
  message,
  patientContext,
  city,
  conversationHistory = [],
  language = 'ar'
}) {
  const isArabic = language === 'ar';
  const context = buildPatientContext(patientContext);
  const counts = dataCounts(context);
  const contextJson = JSON.stringify(context);

  if (isPharmacyRequest(message)) {
    return {
      responseType: 'pharmacy_search',
      assistantMessage: isArabic
        ? `هذه الصيدليات المسجلة في شبكة Vita والمتوفرة في ${city || 'مدينتك'}.`
        : `These are the pharmacies registered in the Vita network and available in ${city || 'your city'}.`,
      needsCity: !city,
      city: city || '',
      needsDoctorReferral: false,
      needsPharmacyReferral: true,
      detectedSpecialty: '',
      confidence: 'high',
    };
  }

  if (isDoctorRequest(message, conversationHistory)) {
    if (!containsActualSymptoms(message, conversationHistory)) {
      return {
        responseType: 'ask_symptoms',
        assistantMessage: isArabic
          ? 'اكتب لي الأعراض أو المشكلة الصحية التي تعاني منها، ومتى بدأت ومدى شدتها، حتى أحدد لك التخصص الطبي المناسب.'
          : 'Tell me your symptoms or health problem, when it started, and how severe it is so I can identify the right specialty.',
        needsCity: false,
        city: city || '',
        needsDoctorReferral: false,
        detectedSpecialty: '',
        confidence: 'high',
      };
    }

    const specialty = detectSpecialty(message, context, conversationHistory);
    return {
      responseType: 'doctor_referral',
      assistantMessage: isArabic
        ? `بناءً على المشكلة التي وصفتها، التخصص الأقرب هو ${specialty}. سأعرض لك الأطباء المتوفرين في ${city || 'مدينتك'}.`
        : `Based on the problem you described, the closest specialty is ${specialty}. I will show available doctors in ${city || 'your city'}.`,
      needsCity: !city,
      city: city || '',
      needsDoctorReferral: true,
      detectedSpecialty: specialty,
      specialtyReason: message,
      confidence: 'high',
    };
  }

  if (isSummaryRequest(message)) {
    const assistantMessage = buildCompleteSummary(context, language);
    return {
      responseType: 'history_explanation',
      assistantMessage,
      needsCity: false,
      city: city || '',
      needsDoctorReferral: false,
      detectedSpecialty: '',
      confidence: 'high',
    };
  }

  const fallback = isArabic
    ? 'لم أتمكن من تجهيز إجابة مكتملة من الملف الصحي. أعد صياغة السؤال بشكل محدد، أو اطلب ملخص حالتك الصحية.'
    : 'I could not prepare a complete answer from the health record. Ask a more specific question or request your health summary.';
  const prompt = isArabic ? `
أنت مساعد طبي للمريض داخل منصة Vita. أجب عن سؤال المريض اعتمادًا حصريًا على ملفه الصحي أدناه.

قواعد إلزامية:
- أجب مباشرة وبسرعة، وبنص عربي واضح وكامل دون JSON أو Markdown.
- استخدم الملف الصحي للمعلومات الشخصية والنتائج المسجلة، واستخدم معرفتك الطبية العامة لشرحها والإجابة عن الأسئلة العامة.
- ميّز بوضوح بين ما هو مسجل في الملف وبين المعلومات الطبية العامة.
- اذكر السجل أو الفحص الذي جاءت منه المعلومة عندما يكون ذلك مفيدًا.
- إذا سأل عن معلومة شخصية غير موجودة، قل إنها غير مسجلة، ثم قدّم شرحًا طبيًا عامًا مفيدًا إن أمكن.
- لا تخترع نتيجة شخصية، ولا تجزم بتشخيص، ولا تصف دواءً أو جرعة.
- لا تكرر عبارة مراجعة الطبيب في كل رد؛ استخدمها فقط عند وجود أعراض تحتاج تقييمًا أو علامة تحذيرية.
- راعِ سياق المحادثة السابقة ولا تعيد السؤال الذي أجاب عنه المريض.

سؤال المريض: ${message}
المحادثة السابقة: ${JSON.stringify(conversationHistory)}
بيانات المريض:
${contextJson}
` : `
Answer directly and concisely in plain text. Use the health record for personal facts and your general medical knowledge to explain them and answer general questions. Clearly distinguish recorded facts from general information. Do not invent personal findings, make a definitive diagnosis, or prescribe medication. Use the previous conversation and do not repeat questions already answered. Only recommend medical review when relevant, not in every response.

Patient question: ${message}
Previous conversation: ${JSON.stringify(conversationHistory)}
Patient data:
${contextJson}
`;
  const assistantMessage = await generatePlainText(prompt, fallback);
  return {
    responseType: 'general',
    assistantMessage,
    needsCity: false,
    city: city || '',
    needsDoctorReferral: false,
    detectedSpecialty: '',
    confidence: 'high',
  };
}

module.exports = {
  patientAssistantChat,
  buildPatientContext,
  detectSpecialty,
};
