// Bilingual specialties list with stable keys.
// Default export remains the English array for backward compatibility,
// with additional properties for Arabic and the full mapping.

const MAP = [
  // Primary Care
  { key: 'general_practice', en: 'General Practice', ar: 'طب عام' },
  { key: 'family_medicine', en: 'Family Medicine', ar: 'طب الأسرة' },
  { key: 'internal_medicine', en: 'Internal Medicine', ar: 'الطب الباطني' },
  
  // Surgical Specialties
  { key: 'general_surgery', en: 'General Surgery', ar: 'الجراحة العامة' },
  { key: 'orthopedics', en: 'Orthopedics', ar: 'جراحة العظام' },
  { key: 'cardiovascular_surgery', en: 'Cardiovascular Surgery', ar: 'جراحة القلب والأوعية الدموية' },
  { key: 'neurosurgery', en: 'Neurosurgery', ar: 'جراحة الأعصاب' },
  { key: 'thoracic_surgery', en: 'Thoracic Surgery', ar: 'جراحة الصدر' },
  { key: 'vascular_surgery', en: 'Vascular Surgery', ar: 'جراحة الأوعية الدموية' },
  { key: 'urologic_surgery', en: 'Urologic Surgery', ar: 'جراحة المسالك البولية' },
  { key: 'plastic_surgery', en: 'Plastic Surgery', ar: 'جراحة التجميل والترميم' },
  
  // Cardiology & Vascular
  { key: 'cardiology', en: 'Cardiology', ar: 'أمراض القلب' },
  { key: 'interventional_cardiology', en: 'Interventional Cardiology', ar: 'القلب التداخلي' },
  { key: 'cardiac_surgery', en: 'Cardiac Surgery', ar: 'جراحة القلب' },
  
  // Respiratory & Pulmonology
  { key: 'pulmonology', en: 'Pulmonology', ar: 'أمراض الجهاز التنفسي' },
  { key: 'sleep_medicine', en: 'Sleep Medicine', ar: 'طب النوم' },
  
  // Gastroenterology & Hepatology
  { key: 'gastroenterology', en: 'Gastroenterology', ar: 'أمراض الجهاز الهضمي' },
  { key: 'hepatology', en: 'Hepatology', ar: 'أمراض الكبد' },
  
  // Neurology & Psychiatry
  { key: 'neurology', en: 'Neurology', ar: 'الأعصاب' },
  { key: 'psychiatry', en: 'Psychiatry', ar: 'الطب النفسي' },
  { key: 'psychologist', en: 'Psychologist', ar: 'الطبيب النفسي' },
  { key: 'pain_management', en: 'Pain Management', ar: 'إدارة الألم' },
  
  // Nephrology & Urology
  { key: 'nephrology', en: 'Nephrology', ar: 'أمراض الكلى' },
  { key: 'urology', en: 'Urology', ar: 'المسالك البولية' },
  
  // Endocrinology & Metabolic
  { key: 'endocrinology', en: 'Endocrinology', ar: 'الغدد الصماء والاستقلاب' },
  { key: 'diabetology', en: 'Diabetology', ar: 'طب السكري' },
  
  // Oncology
  { key: 'oncology', en: 'Oncology', ar: 'الأورام' },
  { key: 'medical_oncology', en: 'Medical Oncology', ar: 'الأورام الطبية' },
  { key: 'surgical_oncology', en: 'Surgical Oncology', ar: 'جراحة الأورام' },
  { key: 'radiation_oncology', en: 'Radiation Oncology', ar: 'الأورام الإشعاعية' },
  
  // Hematology & Immunology
  { key: 'hematology', en: 'Hematology', ar: 'أمراض الدم' },
  { key: 'allergy_immunology', en: 'Allergy & Immunology', ar: 'الحساسية والمناعة' },
  
  // Rheumatology & Autoimmune
  { key: 'rheumatology', en: 'Rheumatology', ar: 'الروماتيزم والأمراض المناعية' },
  
  // Infectious Disease
  { key: 'infectious_disease', en: 'Infectious Disease', ar: 'الأمراض المعدية' },
  { key: 'tropical_medicine', en: 'Tropical Medicine', ar: 'الطب الاستوائي' },
  
  // Dermatology
  { key: 'dermatology', en: 'Dermatology', ar: 'الجلدية والتناسليات' },
  { key: 'dermatologic_surgery', en: 'Dermatologic Surgery', ar: 'جراحة الجلد' },
  
  // ENT (Otolaryngology)
  { key: 'ent', en: 'Otolaryngology (ENT)', ar: 'أنف وأذن وحنجرة' },
  { key: 'otology', en: 'Otology', ar: 'أمراض الأذن' },
  { key: 'rhinology', en: 'Rhinology', ar: 'أمراض الأنف والجيوب' },
  { key: 'laryngology', en: 'Laryngology', ar: 'أمراض الحنجرة' },
  
  // Ophthalmology
  { key: 'ophthalmology', en: 'Ophthalmology', ar: 'طب العيون' },
  { key: 'optometry', en: 'Optometry', ar: 'البصريات' },
  { key: 'cornea_refractive', en: 'Cornea & Refractive Surgery', ar: 'جراحة القرنية والانكسار' },
  
  // OB/GYN
  { key: 'gynecology', en: 'Gynecology', ar: 'أمراض النساء' },
  { key: 'obstetrics', en: 'Obstetrics', ar: 'التوليد' },
  { key: 'maternal_fetal_medicine', en: 'Maternal-Fetal Medicine', ar: 'طب الأم والجنين' },
  { key: 'reproductive_endocrinology', en: 'Reproductive Endocrinology', ar: 'الغدد الصماء الإنجابية والعقم' },
  
  // Pediatrics
  { key: 'pediatrics', en: 'Pediatrics', ar: 'طب الأطفال' },
  { key: 'pediatric_cardiology', en: 'Pediatric Cardiology', ar: 'أمراض قلب الأطفال' },
  { key: 'pediatric_surgery', en: 'Pediatric Surgery', ar: 'جراحة الأطفال' },
  { key: 'neonatology', en: 'Neonatology', ar: 'طب حديثي الولادة' },
  { key: 'pediatric_oncology', en: 'Pediatric Oncology', ar: 'أورام الأطفال' },
  
  // Geriatrics
  { key: 'geriatrics', en: 'Geriatrics', ar: 'طب الشيخوخة' },
  
  // Emergency & Critical Care
  { key: 'emergency_medicine', en: 'Emergency Medicine', ar: 'الطب الطارئ' },
  { key: 'critical_care', en: 'Critical Care Medicine', ar: 'طب العناية الحثيثة' },
  { key: 'trauma_surgery', en: 'Trauma Surgery', ar: 'جراحة الصدمات' },
  
  // Rehabilitation & Physical Medicine
  { key: 'physical_medicine_rehabilitation', en: 'Physical Medicine & Rehabilitation', ar: 'الطب الطبيعي وإعادة التأهيل' },
  { key: 'physical_therapy_rehabilitation', en: 'Physical Therapy & Rehabilitation', ar: 'العلاج الطبيعي وإعادة التأهيل' },
  { key: 'sports_medicine', en: 'Sports Medicine', ar: 'طب الرياضة' },
  
  // Diagnostic & Procedural
  { key: 'radiology', en: 'Radiology', ar: 'الأشعات التشخيصية' },
  { key: 'interventional_radiology', en: 'Interventional Radiology', ar: 'الأشعات التداخلية' },
  { key: 'pathology', en: 'Pathology', ar: 'علم الأمراض' },
  { key: 'laboratory_medicine', en: 'Laboratory Medicine', ar: 'الطب المخبري' },
  { key: 'nuclear_medicine', en: 'Nuclear Medicine', ar: 'الطب النووي' },
  
  // Anesthesia
  { key: 'anesthesiology', en: 'Anesthesiology', ar: 'التخدير والعناية الحثيثة' },
  
  // Other Specialties
  { key: 'public_health', en: 'Public Health', ar: 'الصحة العامة' },
  { key: 'occupational_medicine', en: 'Occupational Medicine', ar: 'طب المهن' },
  { key: 'preventive_medicine', en: 'Preventive Medicine', ar: 'الطب الوقائي' },
  { key: 'dental_surgery', en: 'Dental Surgery', ar: 'جراحة الأسنان' },
  { key: 'orthodontics', en: 'Orthodontics', ar: 'تقويم الأسنان' },
  { key: 'audiology', en: 'Audiology', ar: 'السمعيات' },
  { key: 'speech_pathology', en: 'Speech Pathology', ar: 'أمراض النطق واللغة' },
];

const EN = MAP.map(s => s.en);
const AR = MAP.map(s => s.ar);

// Export English array with extra properties.
EN.MAP = MAP;
EN.EN = EN;
EN.AR = AR;

module.exports = EN;