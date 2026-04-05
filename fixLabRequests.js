const mongoose = require('mongoose');
const MONGODB_URI = 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

mongoose.connect(MONGODB_URI).then(async () => {
  const LabRequest = require('./models/LabRequest');
  const MedicalTest = require('./models/MedicalTest');
  const Clinic = require('./models/Clinic');
  const User = require('./models/User');

  // First, delete the old requests we just created
  const oldIds = [
    '69d29b7e2e216031716e37f7','69d29b7f2e216031716e37fa','69d29b7f2e216031716e37ff',
    '69d29b802e216031716e3804','69d29b802e216031716e3807','69d29b802e216031716e380a',
    '69d29b802e216031716e380d','69d29b812e216031716e3810','69d29b812e216031716e3813',
    '69d29b812e216031716e3816','69d29b822e216031716e3819','69d29b822e216031716e381c',
    '69d29b822e216031716e381f','69d29b822e216031716e3822','69d29b822e216031716e3825',
    '69d29b832e216031716e3828','69d29b832e216031716e382b','69d29b832e216031716e382e',
    '69d29b832e216031716e3831','69d29b832e216031716e3834','69d29b842e216031716e3837',
    '69d29b842e216031716e383a','69d29b842e216031716e383d','69d29b852e216031716e3840',
    '69d29b852e216031716e3843','69d29b852e216031716e3846','69d29b852e216031716e3849',
    '69d29b852e216031716e384c','69d29b862e216031716e384f','69d29b862e216031716e3852',
    '69d29b862e216031716e3855','69d29b862e216031716e3858','69d29b862e216031716e385b',
    '69d29b862e216031716e385e','69d29b862e216031716e3861','69d29b872e216031716e3864',
    '69d29b872e216031716e3867','69d29b872e216031716e386a','69d29b872e216031716e386d',
    '69d29b872e216031716e3870','69d29b872e216031716e3873','69d29b882e216031716e3876',
    '69d29b882e216031716e3879','69d29b882e216031716e387c'
  ];
  
  const deleteResult = await LabRequest.deleteMany({ _id: { $in: oldIds } });
  console.log('Deleted old requests:', deleteResult.deletedCount);

  // Find the test clinic and its lab tech
  const testClinic = await Clinic.findOne({ name: /تجريبية|test/i });
  if (testClinic === null) {
    console.log('Test clinic not found');
    process.exit(1);
  }
  console.log('Test Clinic:', testClinic.name, testClinic._id);
  
  const labTechStaff = testClinic.staff.find(function(s) { return s.role === 'LabTech' && s.status === 'active'; });
  const accountantStaff = testClinic.staff.find(function(s) { return s.role === 'Accountant' && s.status === 'active'; });
  const doctorEntry = testClinic.doctors[0];
  
  console.log('Lab Tech:', labTechStaff ? labTechStaff.userId : 'NOT FOUND');
  console.log('Accountant:', accountantStaff ? accountantStaff.userId : 'NOT FOUND');
  console.log('Doctor:', doctorEntry ? doctorEntry.doctorId : 'NOT FOUND');

  const patientId = '69ce7f6d49893bf019b5cc2a'; // ناصر سايح
  const labId = labTechStaff ? labTechStaff.userId : null;
  const accountantId = accountantStaff ? accountantStaff.userId : null;
  const doctorId = doctorEntry ? doctorEntry.doctorId : null;
  const clinicId = testClinic._id;

  if (labId === null) {
    console.log('No lab tech found in test clinic');
    process.exit(1);
  }

  const testNames = [
    'CBC','Blood Group','Urinalysis','Stool Analysis','GTT','GCT',
    'SGPT (ALT)','SGOT (AST)','ALK-Phosphatase','Bilirubin (T)',
    'Albumin','Cholesterol','Triglycerides','HDL - cholesterol','LDL-cholesterol',
    'Creatinine, serum','BUN','Hb A1c','FBG or RBG or PPBG',
    'Ca, serum','Mg','Iron','Zinc (serum, semen)','Uric Acid, serum',
    'FSH','LH','Prolactin','BHCG Quantitative','Pregnancy test',
    'H.Pylori Ag in stool','HBsAg Screening','Occult blood',
    'CRP','RF','ASOT','TSH','Free T4','Free T3',
    'Thyroid Peroxidase Abs','TSH receptor Abs (TSI)',
    'PTH','Ferritin','Vitamin B12','25-OH-Vitamin D3',
  ];

  let created = 0;
  for (var i = 0; i < testNames.length; i++) {
    var name = testNames[i];
    var test = await MedicalTest.findOne({ name: name, isActive: true });
    if (test === null) {
      console.log('NOT FOUND:', name);
      continue;
    }

    var labRequest = new LabRequest({
      patientId: patientId,
      doctorId: doctorId,
      labId: labId,
      testIds: [test._id],
      notes: 'طلب اختبار - ' + name,
      totalCost: test.price || 0,
      requestedBy: accountantId,
      clinicId: clinicId,
      approvalStatus: 'approved',
      status: 'pending'
    });

    await labRequest.save();
    created++;
    console.log('Created:', name);
  }

  console.log('\nTotal created:', created);
  await mongoose.disconnect();
  process.exit(0);
}).catch(function(err) {
  console.error(err);
  process.exit(1);
});
