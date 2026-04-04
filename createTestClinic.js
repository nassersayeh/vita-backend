const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => { console.error('❌ MongoDB connection error:', err); process.exit(1); });

const User = require('./models/User');
const Clinic = require('./models/Clinic');

async function createTestClinic() {
  try {
    const password = await bcrypt.hash('123456', 10);

    // ==============================
    // 1. إنشاء حساب العيادة (Clinic)
    // ==============================
    const clinicMobile = '050000001';
    
    // حذف الحسابات القديمة إذا كانت موجودة (للتيست)
    const mobilesToClean = ['050000001', '050000002', '050000003', '050000004', '050000005'];
    for (const m of mobilesToClean) {
      const existing = await User.findOne({ mobileNumber: m });
      if (existing) {
        await User.deleteOne({ _id: existing._id });
        console.log(`🗑️  حذف حساب قديم: ${m}`);
      }
    }
    // حذف العيادة القديمة إذا كانت موجودة
    const oldClinic = await Clinic.findOne({ name: 'عيادة تجريبية - Test Clinic' });
    if (oldClinic) {
      await Clinic.deleteOne({ _id: oldClinic._id });
      console.log('🗑️  حذف عيادة قديمة');
    }

    const clinicUser = new User({
      fullName: 'عيادة تجريبية',
      email: 'testclinic@vita.com',
      mobileNumber: clinicMobile,
      password: password,
      role: 'Clinic',
      country: 'Palestine',
      city: 'Ramallah',
      address: 'رام الله - فلسطين',
      idNumber: 'TEST-CLINIC-001',
      isPhoneVerified: true,
      activationStatus: 'active',
      isPaid: true,
      language: 'ar'
    });
    await clinicUser.save();
    console.log('✅ تم إنشاء حساب العيادة:', clinicUser._id);

    // إنشاء سجل العيادة
    const clinic = new Clinic({
      ownerId: clinicUser._id,
      name: 'عيادة تجريبية - Test Clinic',
      description: 'عيادة تجريبية للاختبار',
      maxDoctors: 10,
      doctors: [],
      staff: [],
      settings: {
        allowDoctorFinancialView: true,
        allowDoctorPatientView: true,
        allowDoctorScheduleEdit: true,
        autoApproveAppointments: false
      },
      isActive: true
    });
    await clinic.save();
    console.log('✅ تم إنشاء سجل العيادة:', clinic._id);

    // ==============================
    // 2. إنشاء حساب الطبيب (Doctor)
    // ==============================
    const doctorUser = new User({
      fullName: 'د. تجريبي',
      email: 'testdoctor@vita.com',
      mobileNumber: '050000002',
      password: password,
      role: 'Doctor',
      specialty: 'طب عام',
      country: 'Palestine',
      city: 'Ramallah',
      address: 'رام الله - فلسطين',
      idNumber: 'TEST-DOC-001',
      isPhoneVerified: true,
      activationStatus: 'active',
      isPaid: true,
      language: 'ar',
      managedByClinic: true,
      clinicId: clinic._id,
      consultationFee: 50,
      yearsOfExperience: 5,
      bio: 'طبيب تجريبي للاختبار',
      workplaces: [{
        name: 'عيادة تجريبية - Test Clinic',
        address: 'رام الله - فلسطين',
        isActive: true
      }]
    });
    await doctorUser.save();
    console.log('✅ تم إنشاء حساب الطبيب:', doctorUser._id);

    // إضافة الطبيب للعيادة
    clinic.doctors.push({
      doctorId: doctorUser._id,
      status: 'active',
      notes: 'طب عام',
      clinicPercentage: 30
    });

    // ==============================
    // 3. إنشاء حساب المحاسب (Accountant)
    // ==============================
    const accountantUser = new User({
      fullName: 'محاسب تجريبي',
      email: 'testaccountant@vita.com',
      mobileNumber: '050000003',
      password: password,
      role: 'Accountant',
      country: 'Palestine',
      city: 'Ramallah',
      address: 'رام الله - فلسطين',
      idNumber: 'TEST-ACC-001',
      isPhoneVerified: true,
      activationStatus: 'active',
      language: 'ar',
      clinicId: clinic._id
    });
    await accountantUser.save();
    console.log('✅ تم إنشاء حساب المحاسب:', accountantUser._id);

    // إضافة المحاسب للعيادة
    clinic.staff.push({
      userId: accountantUser._id,
      role: 'Accountant',
      status: 'active',
      notes: 'محاسبة'
    });

    // ==============================
    // 4. إنشاء حساب الممرض (Nurse)
    // ==============================
    const nurseUser = new User({
      fullName: 'ممرض تجريبي',
      email: 'testnurse@vita.com',
      mobileNumber: '050000004',
      password: password,
      role: 'Nurse',
      country: 'Palestine',
      city: 'Ramallah',
      address: 'رام الله - فلسطين',
      idNumber: 'TEST-NRS-001',
      isPhoneVerified: true,
      activationStatus: 'active',
      language: 'ar',
      clinicId: clinic._id
    });
    await nurseUser.save();
    console.log('✅ تم إنشاء حساب الممرض:', nurseUser._id);

    // إضافة الممرض للعيادة
    clinic.staff.push({
      userId: nurseUser._id,
      role: 'Nurse',
      status: 'active',
      notes: 'تمريض'
    });

    // ==============================
    // 5. إنشاء حساب فني المختبر (LabTech)
    // ==============================
    const labTechUser = new User({
      fullName: 'مختبر تجريبي',
      email: 'testlabtech@vita.com',
      mobileNumber: '050000005',
      password: password,
      role: 'LabTech',
      country: 'Palestine',
      city: 'Ramallah',
      address: 'رام الله - فلسطين',
      idNumber: 'TEST-LAB-001',
      isPhoneVerified: true,
      activationStatus: 'active',
      language: 'ar',
      clinicId: clinic._id
    });
    await labTechUser.save();
    console.log('✅ تم إنشاء حساب المختبر:', labTechUser._id);

    // إضافة فني المختبر للعيادة
    clinic.staff.push({
      userId: labTechUser._id,
      role: 'LabTech',
      status: 'active',
      notes: 'مختبر'
    });

    // حفظ العيادة مع جميع الموظفين
    await clinic.save();

    // ==============================
    // طباعة ملخص الحسابات
    // ==============================
    console.log('\n========================================');
    console.log('   ✅ تم إنشاء العيادة التجريبية بنجاح');
    console.log('========================================');
    console.log('');
    console.log('  كلمة المرور لجميع الحسابات: 123456');
    console.log('');
    console.log('  📋 العيادة (Clinic):');
    console.log('     رقم الموبايل: 050000001');
    console.log('     الاسم: عيادة تجريبية');
    console.log('');
    console.log('  👨‍⚕️ الطبيب (Doctor):');
    console.log('     رقم الموبايل: 050000002');
    console.log('     الاسم: د. تجريبي');
    console.log('     التخصص: طب عام');
    console.log('');
    console.log('  💰 المحاسب (Accountant):');
    console.log('     رقم الموبايل: 050000003');
    console.log('     الاسم: محاسب تجريبي');
    console.log('');
    console.log('  🩺 الممرض (Nurse):');
    console.log('     رقم الموبايل: 050000004');
    console.log('     الاسم: ممرض تجريبي');
    console.log('');
    console.log('  🔬 المختبر (LabTech):');
    console.log('     رقم الموبايل: 050000005');
    console.log('     الاسم: مختبر تجريبي');
    console.log('');
    console.log('========================================');

    process.exit(0);
  } catch (error) {
    console.error('❌ خطأ:', error);
    process.exit(1);
  }
}

createTestClinic();
