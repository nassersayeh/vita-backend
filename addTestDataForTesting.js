const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const User = require('./models/User');
const MedicalRecord = require('./models/MedicalRecord');
const EPrescription = require('./models/EPrescription');

// جرّب عدة connections بالترتيب
const MONGO_URIS = [
  'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin',
  process.env.MONGODB_URI,
  'mongodb://localhost:27017/vita',
];

const medicalReports = [
  {
    title: 'فحص ضغط الدم',
    diagnosis: 'ارتفاع ضغط الدم المرحلة الأولى',
    description: 'قياس ضغط الدم: 140/90 mmHg - مرتفع قليلاً',
    findings: 'ضغط الدم مرتفع، يحتاج المراقبة والعلاج المناسب',
    recommendations: 'الراحة، تقليل الملح، ممارسة الرياضة'
  },
  {
    title: 'تحليل الدم الشامل',
    diagnosis: 'فحص روتيني - نتائج طبيعية',
    description: 'تحليل شامل يشمل كريات الدم الحمراء والبيضاء والصفائح',
    findings: 'جميع المؤشرات ضمن الحدود الطبيعية',
    recommendations: 'المتابعة الدورية كل 6 أشهر'
  },
  {
    title: 'فحص السكري',
    diagnosis: 'مقدمات السكري',
    description: 'فحص مستوى الجلوكوز في الدم: 105 mg/dL',
    findings: 'مستوى السكر مرتفع قليلاً، قد يكون مؤشراً لمقدمات السكري',
    recommendations: 'تقليل السكريات، ممارسة الرياضة، فحوصات دورية'
  },
  {
    title: 'أشعة صدر عادية',
    diagnosis: 'فحص الصدر طبيعي',
    description: 'أشعة صدر (CXR) للتحقق من صحة الرئتين والقلب',
    findings: 'لا توجد آفات أو تشوهات واضحة، الرئتان سليمتان',
    recommendations: 'لا توصيات خاصة'
  },
  {
    title: 'موجات فوق صوتية على البطن',
    diagnosis: 'فحص البطن طبيعي',
    description: 'فحص الكبد والطحال والكليتين بالموجات فوق الصوتية',
    findings: 'جميع الأعضاء الداخلية سليمة، بدون تأثر بالدهون',
    recommendations: 'الحفاظ على نمط حياة صحي'
  },
  {
    title: 'تخطيط القلب الكهربائي',
    diagnosis: 'رسم القلب طبيعي',
    description: 'رسم القلب (ECG) 12 رصاص',
    findings: 'النبض منتظم، بدون اختلالات في الإيقاع',
    recommendations: 'المتابعة الدورية سنوياً'
  },
  {
    title: 'تحليل وظائف الكبد والكلى',
    diagnosis: 'وظائف كبد وكلى طبيعية',
    description: 'اختبار AST و ALT و Creatinine و BUN',
    findings: 'جميع المؤشرات طبيعية',
    recommendations: 'استمر في نمط الحياة الصحي'
  },
  {
    title: 'فحص الكوليسترول',
    diagnosis: 'ارتفاع الكوليسترول',
    description: 'فحص مستويات الكوليسترول الكلي والضار والنافع',
    findings: 'الكوليسترول الكلي 240 mg/dL - مرتفع، HDL منخفض',
    recommendations: 'تغيير النظام الغذائي، قد يحتاج علاج دوائي'
  },
  {
    title: 'فحص هرمون الغدة الدرقية',
    diagnosis: 'وظائف الغدة الدرقية طبيعية',
    description: 'قياس TSH و T4 و T3',
    findings: 'جميع المؤشرات ضمن الحدود الطبيعية',
    recommendations: 'لا توصيات خاصة'
  },
  {
    title: 'فحص صحة العظام',
    diagnosis: 'كثافة العظام طبيعية',
    description: 'قياس كثافة العظام (DEXA Scan)',
    findings: 'كثافة العظام طبيعية للعمر',
    recommendations: 'الحصول على كالسيوم وفيتامين D كافي'
  }
];

const prescriptionsData = [
  {
    medicineName: 'ليسينوبريل',
    dosage: 'حبة واحدة',
    frequency: 'مرة واحدة يومياً',
    duration: '30 يوم',
    reason: 'ارتفاع ضغط الدم',
    notes: 'يؤخذ في الصباح قبل الأكل'
  },
  {
    medicineName: 'الميتفورمين',
    dosage: 'حبة واحدة 500mg',
    frequency: 'مرتين يومياً',
    duration: '60 يوم',
    reason: 'مقدمات السكري',
    notes: 'يؤخذ مع الطعام'
  },
  {
    medicineName: 'أتورفاستاتين',
    dosage: '10mg',
    frequency: 'مرة واحدة يومياً',
    duration: '90 يوم',
    reason: 'ارتفاع الكوليسترول',
    notes: 'يؤخذ قبل النوم'
  },
  {
    medicineName: 'أسبرين',
    dosage: 'حبة واحدة 100mg',
    frequency: 'مرة واحدة يومياً',
    duration: 'مستمر',
    reason: 'الوقاية من أمراض القلب',
    notes: 'ضروري يومياً'
  },
  {
    medicineName: 'فيتامين C',
    dosage: 'قرص واحد 1000mg',
    frequency: 'مرة واحدة يومياً',
    duration: 'مستمر',
    reason: 'تقوية المناعة',
    notes: 'يؤخذ مع الطعام'
  },
  {
    medicineName: 'Omega-3',
    dosage: 'كبسولة واحدة',
    frequency: 'مرتين يومياً',
    duration: 'مستمر',
    reason: 'صحة القلب والأوعية الدموية',
    notes: 'يؤخذ مع الطعام'
  },
  {
    medicineName: 'فيتامين D',
    dosage: '2000 وحدة دولية',
    frequency: 'مرة واحدة يومياً',
    duration: 'مستمر',
    reason: 'امتصاص الكالسيوم وصحة العظام',
    notes: 'يفضل مع الطعام الدهني'
  },
  {
    medicineName: 'الزنك',
    dosage: '15mg',
    frequency: 'مرة واحدة يومياً',
    duration: '30 يوم',
    reason: 'تقوية المناعة',
    notes: 'يؤخذ قبل النوم'
  },
  {
    medicineName: 'الماغنيسيوم',
    dosage: '400mg',
    frequency: 'مرة واحدة يومياً',
    duration: '60 يوم',
    reason: 'تحسين جودة النوم والعضلات',
    notes: 'يؤخذ قبل النوم'
  },
  {
    medicineName: 'كالسيوم',
    dosage: '1000mg',
    frequency: 'مرتين يومياً',
    duration: 'مستمر',
    reason: 'صحة العظام',
    notes: 'يؤخذ مع الوجبات'
  }
];

async function addTestData() {
  try {
    // جرّب الاتصال بكل URI بالترتيب
    let connected = false;
    for (const uri of MONGO_URIS) {
      if (!uri) continue;
      
      try {
        console.log(`🔄 محاولة الاتصال: ${uri.substring(0, 50)}...`);
        await mongoose.connect(uri, {
          serverSelectionTimeoutMS: 5000,
          connectTimeoutMS: 5000
        });
        console.log('✅ تم الاتصال بقاعدة البيانات');
        connected = true;
        break;
      } catch (error) {
        console.log(`⚠️  فشل الاتصال: ${error.message.substring(0, 50)}`);
        await mongoose.disconnect().catch(() => {});
        continue;
      }
    }

    if (!connected) {
      console.log('❌ فشل الاتصال بجميع خوادم MongoDB');
      process.exit(1);
    }

    // البحث عن المريض والدكتور
    const patient = await User.findOne({ 
      $or: [
        { mobileNumber: 'nassersayeh' },
        { fullName: 'nassersayeh' }
      ]
    });

    if (!patient) {
      console.log('❌ لم يتم العثور على المريض: nassersayeh');
      process.exit(1);
    }

    console.log(`✅ تم العثور على المريض: ${patient.fullName} (${patient._id})`);

    const doctor = await User.findOne({ 
      mobileNumber: '0599123461',
      role: 'Doctor'
    });

    if (!doctor) {
      console.log('❌ لم يتم العثور على الدكتور برقم: 0599123461');
      process.exit(1);
    }

    console.log(`✅ تم العثور على الدكتور: ${doctor.fullName} (${doctor._id})`);

    // إضافة المريض إلى قائمة مرضى الدكتور
    if (!doctor.patients) {
      doctor.patients = [];
    }
    
    if (!doctor.patients.includes(patient._id)) {
      doctor.patients.push(patient._id);
      await doctor.save();
      console.log(`✅ تم إضافة المريض إلى قائمة أطباء الدكتور`);
    } else {
      console.log('ℹ️  المريض موجود بالفعل في القائمة');
    }

    // إضافة التقارير الطبية
    console.log('\n📋 بدء إضافة التقارير الطبية...');
    const createdReports = [];

    for (let i = 0; i < medicalReports.length; i++) {
      const report = medicalReports[i];
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - (10 - i)); // توزيع التواريخ

      const medicalRecord = new MedicalRecord({
        patient: patient._id,
        doctor: doctor._id,
        date: createdAt,
        recordType: 'initial',
        title: report.title,
        chiefComplaint: report.title,
        diagnosis: report.diagnosis,
        examinationFindings: report.findings,
        recommendations: report.recommendations,
        treatmentPlan: report.description
      });

      await medicalRecord.save();
      createdReports.push(medicalRecord);
      console.log(`✅ تم إضافة التقرير: ${report.title}`);
    }

    // إضافة الروشيتات
    console.log('\n💊 بدء إضافة الروشيتات...');
    const createdPrescriptions = [];

    for (let i = 0; i < prescriptionsData.length; i++) {
      const med = prescriptionsData[i];
      const issuedAt = new Date();
      issuedAt.setDate(issuedAt.getDate() - (10 - i));

      const prescription = new EPrescription({
        patientId: patient._id,
        doctorId: doctor._id,
        products: [{
          name: med.medicineName,
          dose: med.dosage,
          quantity: 1,
          instructions: med.notes
        }],
        diagnosis: med.reason,
        notes: med.notes,
        date: issuedAt,
        expiryDate: new Date(issuedAt.getTime() + 90 * 24 * 60 * 60 * 1000) // ينتهي بعد 90 يوم
      });

      await prescription.save();
      createdPrescriptions.push(prescription);
      console.log(`✅ تم إضافة الروشيتة: ${med.medicineName}`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ تم إنجاز جميع العمليات بنجاح!');
    console.log('='.repeat(50));
    console.log(`
📊 الملخص:
  - المريض: ${patient.fullName} (${patient._id})
  - الدكتور: ${doctor.fullName} (${doctor._id})
  - عدد التقارير المضافة: ${createdReports.length}
  - عدد الروشيتات المضافة: ${createdPrescriptions.length}
    `);

    await mongoose.connection.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ حدث خطأ:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

addTestData();
