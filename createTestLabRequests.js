const mongoose = require('mongoose');
const MONGODB_URI = 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

mongoose.connect(MONGODB_URI).then(async () => {
  const LabRequest = require('./models/LabRequest');
  const MedicalTest = require('./models/MedicalTest');
  const Clinic = require('./models/Clinic');

  const patientId = '69ce7f6d49893bf019b5cc2a'; // ناصر سايح
  const accountantId = '69ce3a496ae5750e29c53513'; // محاسب - مركز الشعب
  const labId = '69ce3a496ae5750e29c5350d'; // مختبر - مركز الشعب
  const clinicId = '69ce33c830727c24d322fdee'; // مركز الشعب

  const clinic = await Clinic.findById(clinicId);
  const doctorId = clinic.doctors[0] ? clinic.doctors[0].doctorId : null;
  console.log('Using doctorId:', doctorId);

  const testNames = [
    'CBC',
    'Blood Group',
    'Urinalysis',
    'Stool Analysis',
    'GTT',
    'GCT',
    'SGPT (ALT)',
    'SGOT (AST)',
    'ALK-Phosphatase',
    'Bilirubin (T)',
    'Albumin',
    'Cholesterol',
    'Triglycerides',
    'HDL - cholesterol',
    'LDL-cholesterol',
    'Creatinine, serum',
    'BUN',
    'Hb A1c',
    'FBG or RBG or PPBG',
    'Ca, serum',
    'Mg',
    'Iron',
    'Zinc (serum, semen)',
    'Uric Acid, serum',
    'FSH',
    'LH',
    'Prolactin',
    'BHCG Quantitative',
    'Pregnancy test',
    'H.Pylori Ag in stool',
    'HBsAg Screening',
    'Occult blood',
    'CRP',
    'RF',
    'ASOT',
    'TSH',
    'Free T4',
    'Free T3',
    'Thyroid Peroxidase Abs',
    'TSH receptor Abs (TSI)',
    'PTH',
    'Ferritin',
    'Vitamin B12',
    '25-OH-Vitamin D3',
  ];

  let created = 0;
  for (const name of testNames) {
    const test = await MedicalTest.findOne({ name: name, isActive: true });
    if (test === null) {
      console.log('NOT FOUND:', name);
      continue;
    }

    const labRequest = new LabRequest({
      patientId,
      doctorId,
      labId,
      testIds: [test._id],
      notes: 'طلب اختبار - ' + name,
      totalCost: test.price || 0,
      requestedBy: accountantId,
      clinicId,
      approvalStatus: 'approved',
      status: 'pending'
    });

    await labRequest.save();
    created++;
    console.log('Created request for:', name, '- ID:', labRequest._id);
  }

  console.log('\nTotal created:', created);
  await mongoose.disconnect();
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
