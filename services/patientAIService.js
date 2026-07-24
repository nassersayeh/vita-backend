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

const LAB_LABELS_AR = {
  result: 'النتيجة',
  color: 'اللون',
  appearance: 'المظهر',
  specificGravity: 'الكثافة النوعية',
  ph: 'درجة الحموضة (pH)',
  leukocytes: 'كريات الدم البيضاء في البول',
  urobilinogen: 'يوروبيلينوجين',
  bilirubin: 'بيليروبين',
  blood: 'دم في البول',
  nitrite: 'نيتريت',
  protein: 'بروتين',
  glucose: 'سكر',
  ketone: 'كيتونات',
  rbcs: 'كريات الدم الحمراء',
  wbcs: 'كريات الدم البيضاء',
  epithelialCells: 'خلايا طلائية',
  bacteria: 'بكتيريا',
  mucus: 'مخاط',
  crystals: 'بلورات',
  amorphous: 'رواسب غير متبلورة',
  casts: 'أسطوانات بولية',
  wbc: 'كريات الدم البيضاء (WBC)',
  rbc: 'كريات الدم الحمراء (RBC)',
  hemoglobin: 'الهيموغلوبين',
  hematocrit: 'الهيماتوكريت',
  platelets: 'الصفائح الدموية',
  lymphocytes: 'الخلايا اللمفاوية',
  granulocytes: 'الخلايا المحببة',
  mid: 'الخلايا المتوسطة (MID)',
  mcv: 'متوسط حجم الكرية (MCV)',
  mch: 'متوسط هيموغلوبين الكرية (MCH)',
  mchc: 'تركيز هيموغلوبين الكرية (MCHC)',
  rdw: 'تباين حجم الكريات (RDW)',
  mpv: 'متوسط حجم الصفائح (MPV)',
};

const LAB_TEST_NAMES_AR = {
  'creatinine, serum': 'كرياتينين الدم',
  creatinine: 'الكرياتينين',
  urinalysis: 'تحليل البول',
  cbc: 'صورة الدم الكاملة (CBC)',
  glucose: 'سكر الدم',
  'fasting blood sugar': 'سكر الدم الصائم',
};

function parseLabResult(value) {
  let current = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (current && typeof current === 'object' && !Array.isArray(current)) return current;
    if (typeof current !== 'string') return current;
    const text = current.trim();
    if (!text.startsWith('{') && !text.startsWith('[') && !text.startsWith('"')) return current;
    try {
      current = JSON.parse(text);
    } catch (_) {
      return current;
    }
  }
  return current;
}

function humanizeKey(key, isArabic) {
  if (isArabic && LAB_LABELS_AR[key]) return LAB_LABELS_AR[key];
  return String(key)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanizeLabValue(value, isArabic) {
  if (!isArabic) return displayValue(value);
  const translations = {
    Yellow: 'أصفر',
    Cloudy: 'عكر',
    Clear: 'صافي',
    Positive: 'إيجابي',
    Negative: 'سلبي',
    Few: 'قليل',
    Many: 'كثير',
    Moderate: 'متوسط',
    Seen: 'موجود',
    'Not Seen': 'غير موجود',
    Normal: 'طبيعي',
    Abnormal: 'غير طبيعي',
    'Granular Cast': 'أسطوانات حبيبية',
    'Amorphous Urate': 'يورات غير متبلورة',
  };
  const text = displayValue(value);
  return translations[text]
    || text
      .replace(/\bMen\s*:/gi, 'الرجال:')
      .replace(/\bWomen\s*:/gi, 'النساء:')
      .replace(/\bMale\s*:/gi, 'الذكور:')
      .replace(/\bFemale\s*:/gi, 'الإناث:');
}

function humanizeTestName(value, isArabic) {
  const text = String(value || '').trim();
  if (!isArabic) return text;
  return LAB_TEST_NAMES_AR[text.toLowerCase()] || text;
}

function labEntryTone(key, value, fallbackTone) {
  const text = String(value || '').trim().toLowerCase();
  const plusValue = /^\+\d|^\d\+$/.test(text);
  if (
    (key === 'appearance' && /cloudy|عكر/.test(text))
    || (key === 'nitrite' && /positive|إيجابي/.test(text))
    || (['leukocytes', 'blood', 'protein', 'glucose', 'ketone', 'bilirubin'].includes(key) && plusValue)
    || (key === 'casts' && text && !/not seen|none|negative|غير موجود/.test(text))
  ) return 'warning';
  return fallbackTone;
}

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

function buildSummaryDetails(context, language) {
  const isArabic = language === 'ar';
  const profile = context.profile || {};
  const row = (label, value, tone = 'neutral') => value !== undefined && value !== null && value !== ''
    ? { label, value: displayValue(value), tone }
    : null;
  const section = (id, title, icon, items, emptyText) => ({
    id,
    title,
    icon,
    items: items.filter((item) => item && (item.rows?.length || item.title || item.subtitle)),
    emptyText: emptyText || (isArabic ? 'لا توجد بيانات مسجلة' : 'No recorded data'),
  });

  const basicRows = [
    row(isArabic ? 'العمر' : 'Age', profile.age !== undefined ? `${profile.age} ${isArabic ? 'سنة' : 'years'}` : ''),
    row(isArabic ? 'الجنس' : 'Sex', profile.sex),
    row(isArabic ? 'فصيلة الدم' : 'Blood type', profile.bloodType),
    row(isArabic ? 'الطول' : 'Height', profile.height ? `${profile.height} ${isArabic ? 'سم' : 'cm'}` : ''),
    row(isArabic ? 'الوزن' : 'Weight', profile.weight ? `${profile.weight} ${isArabic ? 'كغم' : 'kg'}` : ''),
    row(isArabic ? 'مؤشر كتلة الجسم' : 'BMI', profile.bmi),
    row(isArabic ? 'ضغط الدم المسجل' : 'Recorded blood pressure', profile.bloodPressure),
    row(isArabic ? 'سكر الدم المسجل' : 'Recorded blood sugar', profile.bloodSugar),
  ].filter(Boolean);

  const historyRows = [
    row(isArabic ? 'الأمراض المزمنة' : 'Chronic conditions', profile.chronicConditions || profile.chronicDiseasesText),
    row(isArabic ? 'الأمراض السابقة' : 'Past illnesses', profile.pastIllnesses || profile.previousDiseases),
    row(isArabic ? 'العمليات' : 'Surgeries', profile.surgeriesText),
    row(isArabic ? 'الحساسيات' : 'Allergies', profile.allergies),
    row(isArabic ? 'حساسية الأدوية' : 'Drug allergies', profile.drugAllergiesText, 'warning'),
    row(isArabic ? 'حساسية الطعام' : 'Food allergies', profile.foodAllergiesText, 'warning'),
    row(isArabic ? 'الأدوية الحالية' : 'Current medications', profile.medications),
  ].filter(Boolean);

  const records = [
    ...(context.medicalRecords || []).map((record, index) => ({
      id: `record-${index}`,
      title: record.diagnosis || record.preliminaryDiagnosis || record.title || (isArabic ? 'زيارة طبية' : 'Medical visit'),
      subtitle: recordDate(record),
      rows: [
        row(isArabic ? 'الشكوى' : 'Complaint', record.chiefComplaint),
        row(isArabic ? 'التشخيص' : 'Diagnosis', record.diagnosis || record.preliminaryDiagnosis),
        row(isArabic ? 'الفحص السريري' : 'Examination', record.examinationFindings || record.clinicalExamination),
        row(isArabic ? 'الاستقصاءات' : 'Investigations', record.investigations),
        row(isArabic ? 'ملاحظات' : 'Notes', record.notes),
      ].filter(Boolean),
    })),
    ...(context.legacyMedicalRecords || []).map((record, index) => ({
      id: `legacy-${index}`,
      title: record.issueDescription || (isArabic ? 'سجل طبي سابق' : 'Previous medical record'),
      subtitle: recordDate(record),
      rows: [
        row(isArabic ? 'المشكلة' : 'Issue', record.issueDescription),
        row(isArabic ? 'الخطة المسجلة' : 'Recorded plan', record.treatmentPlan),
        row(isArabic ? 'الوصفة المسجلة' : 'Recorded prescription', record.ePrescription),
      ].filter(Boolean),
    })),
  ];

  const prescriptions = (context.prescriptions || []).map((prescription, index) => ({
    id: `prescription-${index}`,
    title: prescription.diagnosis || (isArabic ? `وصفة طبية ${index + 1}` : `Prescription ${index + 1}`),
    subtitle: recordDate(prescription),
    rows: [
      ...(prescription.products || []).map((product) => row(
        product.name || (isArabic ? 'دواء' : 'Medication'),
        [product.dose, product.instructions].filter(Boolean).join(' — ') || (isArabic ? 'لا توجد تعليمات مسجلة' : 'No recorded instructions')
      )),
      row(isArabic ? 'ملاحظات' : 'Notes', prescription.notes),
    ].filter(Boolean),
  }));

  const labs = (context.labRequestsAndResults || []).map((request, requestIndex) => {
    const requestTestNames = (request.testIds || [])
      .map((test) => test.nameAr || test.name || test.nameEn)
      .filter(Boolean);
    const resultRows = (request.results || []).flatMap((result, resultIndex) => {
      const test = result.testId && typeof result.testId === 'object' ? result.testId : {};
      const rawName = test.nameAr || test.name || test.nameEn || result.testName || result.name
        || requestTestNames[resultIndex] || request.testName || `${isArabic ? 'نتيجة' : 'Result'} ${resultIndex + 1}`;
      const name = humanizeTestName(rawName, isArabic);
      const normalRange = result.normalRange || test.normalRange;
      const unit = result.unit || test.unit || '';
      const tone = result.isNormal === false ? 'warning' : result.isNormal === true ? 'good' : 'neutral';
      const parsedResult = parseLabResult(result.result);
      const structuredEntries = parsedResult && typeof parsedResult === 'object' && !Array.isArray(parsedResult)
        ? Object.entries(parsedResult)
        : [];

      if (structuredEntries.length > 1 || (structuredEntries.length === 1 && structuredEntries[0][0] !== 'result')) {
        return [
          ...structuredEntries.map(([key, value]) => row(
            humanizeKey(key, isArabic),
            humanizeLabValue(value, isArabic),
            labEntryTone(key, value, tone)
          )),
          result.notes ? row(isArabic ? 'ملاحظة المختبر' : 'Lab note', result.notes) : null,
        ].filter(Boolean);
      }

      const scalarValue = structuredEntries.length === 1 ? structuredEntries[0][1] : parsedResult;
      const value = [humanizeLabValue(scalarValue, isArabic), unit].filter(Boolean).join(' ');
      return [
        row(name, value || (isArabic ? 'لم تُسجل قيمة' : 'No value recorded'), tone),
        normalRange ? row(
          isArabic ? `المعدل الطبيعي لـ ${name}` : `Normal range for ${name}`,
          humanizeLabValue(normalRange, isArabic)
        ) : null,
        result.notes ? row(isArabic ? `ملاحظة على ${name}` : `Note for ${name}`, result.notes) : null,
      ].filter(Boolean);
    });
    return {
      id: `lab-${requestIndex}`,
      title: humanizeTestName(request.testName || requestTestNames.join('، '), isArabic)
        || (isArabic ? `فحص مخبري ${requestIndex + 1}` : `Lab test ${requestIndex + 1}`),
      subtitle: [
        recordDate(request),
        isArabic && request.status === 'completed' ? 'مكتمل' : request.status,
      ].filter(Boolean).join(' • '),
      rows: resultRows.length ? resultRows : [
        row(isArabic ? 'النتيجة' : 'Result', isArabic ? 'لم تُسجل نتيجة بعد' : 'No result recorded yet'),
      ],
    };
  });

  const imaging = (context.imagingRequestsAndResults || []).map((request, index) => ({
    id: `imaging-${index}`,
    title: [request.imageType, request.bodyPart].filter(Boolean).join(' - ') || (isArabic ? `تصوير طبي ${index + 1}` : `Imaging ${index + 1}`),
    subtitle: [recordDate(request), request.status].filter(Boolean).join(' • '),
    rows: [
      row(isArabic ? 'النتائج' : 'Findings', request.findings),
      row(isArabic ? 'ملاحظات اختصاصي الأشعة' : 'Radiologist notes', request.radiologistNotes),
      row(isArabic ? 'ملاحظات' : 'Notes', request.notes),
    ].filter(Boolean),
  }));

  return {
    patientName: profile.fullName || '',
    sections: [
      section('basic', isArabic ? 'المعلومات الأساسية' : 'Basic information', 'person', [{ id: 'basic-info', rows: basicRows }]),
      section('history', isArabic ? 'التاريخ الصحي' : 'Health history', 'heart', [{ id: 'health-history', rows: historyRows }]),
      section('records', isArabic ? 'الزيارات والتشخيصات' : 'Visits and diagnoses', 'medical', records),
      section('prescriptions', isArabic ? 'الأدوية والوصفات' : 'Medications and prescriptions', 'medkit', prescriptions),
      section('labs', isArabic ? 'الفحوصات المخبرية' : 'Laboratory tests', 'flask', labs),
      section('imaging', isArabic ? 'الأشعة والتصوير' : 'Imaging', 'scan', imaging),
    ],
  };
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
    const assistantMessage = isArabic
      ? 'هذا ملخص منظم للمعلومات المسجلة في ملفك الصحي. اضغط على أي قسم واقرأ تفاصيله، ويمكنك سؤالي عن أي نتيجة تحتاج شرحًا أبسط.'
      : 'Here is an organized summary of your recorded health information. You can ask me to explain any result more simply.';
    return {
      responseType: 'history_explanation',
      assistantMessage,
      summaryDetails: buildSummaryDetails(context, language),
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
