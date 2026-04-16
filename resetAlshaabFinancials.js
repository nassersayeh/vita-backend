/**
 * سكريبت تصفير البيانات المالية لمركز الشعب
 * =========================================
 * 
 * هذا السكريبت يقوم بـ:
 * 1. تصفير جميع المعاملات المالية (transactions, debts, expenses) للعيادة والأطباء
 * 2. تصفير totalEarnings و totalExpenses
 * 3. تصفير البيانات المالية على المواعيد (appointmentFee, debt, isPaid, etc.)
 * 4. تصفير البيانات المالية على طلبات المختبر (isPaid, paidAmount, etc.)
 * 5. تصفير دفعات الأطباء (doctorPaid, doctorPaidAmount, etc.)
 * 
 * ❌ لا يحذف: المرضى، التقارير الطبية، ملفات المرضى
 * ✅ يحذف فقط: المعاملات المالية والديون والمصاريف وحالات الدفع
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ متصل بقاعدة البيانات'))
  .catch(err => { console.error('❌ خطأ في الاتصال:', err.message); process.exit(1); });

const User = require('./models/User');
const Clinic = require('./models/Clinic');
const Financial = require('./models/Financial');
const Appointment = require('./models/Appointment');
const LabRequest = require('./models/LabRequest');

async function resetAlshaabFinancials() {
  try {
    // ==================== البحث عن مركز الشعب ====================
    console.log('\n🔍 البحث عن مركز الشعب...');
    
    const clinic = await Clinic.findOne({ name: { $regex: 'شعب', $options: 'i' } });
    if (!clinic) {
      // Try searching by owner name
      console.log('  محاولة البحث بطريقة أخرى...');
      const allClinics = await Clinic.find({});
      console.log(`  عدد العيادات الموجودة: ${allClinics.length}`);
      for (const c of allClinics) {
        console.log(`  - ${c.name} (ID: ${c._id})`);
      }
      throw new Error('مركز الشعب غير موجود! تحقق من الأسماء أعلاه');
    }
    
    console.log(`  ✅ تم العثور على: ${clinic.name} (ID: ${clinic._id})`);
    
    // ==================== جمع كل الحسابات المرتبطة ====================
    console.log('\n👥 جمع الحسابات المرتبطة...');
    
    const clinicId = clinic._id;
    const ownerId = clinic.ownerId;
    
    // صاحب العيادة
    const owner = await User.findById(ownerId);
    if (owner) {
      console.log(`  مالك العيادة: ${owner.fullName} (${owner.role}) - ID: ${ownerId}`);
    }
    
    // الأطباء من clinic.doctors
    const doctorIds = clinic.doctors.map(d => d.doctorId);
    const doctors = await User.find({ _id: { $in: doctorIds } });
    console.log(`  عدد الأطباء: ${doctors.length}`);
    for (const doc of doctors) {
      console.log(`    - د. ${doc.fullName} (ID: ${doc._id})`);
    }
    
    // الموظفون (محاسب، ممرض، فني مختبر) المرتبطون بالعيادة
    const staff = await User.find({ 
      clinicId: clinicId, 
      role: { $in: ['Accountant', 'Nurse', 'LabTech'] } 
    });
    console.log(`  عدد الموظفين: ${staff.length}`);
    for (const s of staff) {
      console.log(`    - ${s.fullName} (${s.role}) - ID: ${s._id}`);
    }
    
    // كل الـ IDs المالية (مالك + أطباء)
    const allFinancialUserIds = [ownerId, ...doctorIds];
    
    // ==================== تأكيد من المستخدم ====================
    console.log('\n⚠️  ============================================');
    console.log('⚠️  سيتم تصفير البيانات المالية التالية:');
    console.log('⚠️  ============================================');
    console.log(`  📋 سجلات Financial للمالك و ${doctors.length} طبيب`);
    console.log('  📋 حالات الدفع على جميع المواعيد');
    console.log('  📋 حالات الدفع على طلبات المختبر');
    console.log('  📋 الديون والمصاريف والمعاملات');
    console.log('');
    console.log('  ✅ لن يتم حذف: المرضى، التقارير الطبية، السجلات الطبية');
    console.log('⚠️  ============================================\n');

    // ==================== STEP 1: تصفير سجلات Financial ====================
    console.log('📊 الخطوة 1: تصفير سجلات Financial...');
    
    for (const userId of allFinancialUserIds) {
      const user = await User.findById(userId);
      const userName = user ? user.fullName : userId;
      
      // البحث بـ doctorId (للأطباء والمالك)
      let financial = await Financial.findOne({ doctorId: userId });
      if (financial) {
        const oldTransactions = financial.transactions.length;
        const oldDebts = financial.debts.length;
        const oldExpenses = financial.expenses.length;
        const oldEarnings = financial.totalEarnings;
        const oldExpensesTotal = financial.totalExpenses;
        
        financial.totalEarnings = 0;
        financial.totalExpenses = 0;
        financial.transactions = [];
        financial.debts = [];
        financial.expenses = [];
        await financial.save();
        
        console.log(`  ✅ ${userName}: صُفّر (أرباح: ${oldEarnings}→0, مصاريف: ${oldExpensesTotal}→0, معاملات: ${oldTransactions}→0, ديون: ${oldDebts}→0, مصاريف: ${oldExpenses}→0)`);
      } else {
        console.log(`  ⚪ ${userName}: لا يوجد سجل Financial`);
      }
    }
    
    // ==================== STEP 2: تصفير المواعيد ماليًا ====================
    console.log('\n📅 الخطوة 2: تصفير البيانات المالية على المواعيد...');
    
    // المواعيد التابعة للعيادة أو لأطبائها
    const appointmentFilter = {
      $or: [
        { clinicId: clinicId },
        { doctorId: { $in: doctorIds } }
      ]
    };
    
    const appointmentsBefore = await Appointment.find(appointmentFilter);
    console.log(`  عدد المواعيد: ${appointmentsBefore.length}`);
    
    const aptUpdateResult = await Appointment.updateMany(
      appointmentFilter,
      {
        $set: {
          isPaid: false,
          paymentAmount: 0,
          paidAt: null,
          autoMarkedAsPaid: false,
          appointmentFee: 0,
          debt: 0,
          debtStatus: 'none',
          doctorFee: 0,
          clinicFee: 0,
          clinicShare: 0,
          doctorShare: 0,
          doctorPaid: false,
          doctorPaidAt: null,
          doctorPaidAmount: 0,
        }
      }
    );
    console.log(`  ✅ تم تصفير ${aptUpdateResult.modifiedCount} موعد ماليًا (لم يتم حذف المواعيد نفسها)`);
    
    // ==================== STEP 3: تصفير طلبات المختبر ماليًا ====================
    console.log('\n🔬 الخطوة 3: تصفير البيانات المالية على طلبات المختبر...');
    
    const labFilter = {
      $or: [
        { clinicId: clinicId },
        { doctorId: { $in: doctorIds } }
      ]
    };
    
    const labRequestsBefore = await LabRequest.find(labFilter);
    console.log(`  عدد طلبات المختبر: ${labRequestsBefore.length}`);
    
    const labUpdateResult = await LabRequest.updateMany(
      labFilter,
      {
        $set: {
          isPaid: false,
          paidAmount: 0,
          paidAt: null,
          paidBy: null,
          discount: 0,
          discountAmount: 0,
        }
      }
    );
    console.log(`  ✅ تم تصفير ${labUpdateResult.modifiedCount} طلب مختبر ماليًا (لم يتم حذف الطلبات نفسها)`);

    // ==================== STEP 4: تصفير نسب الأطباء (اختياري) ====================
    // لا نعدل النسب، نتركها كما هي لأنها إعدادات وليست بيانات مالية

    // ==================== التحقق النهائي ====================
    console.log('\n✅ ============================================');
    console.log('✅ تم الانتهاء! ملخص:');
    console.log('✅ ============================================');
    
    // تحقق من السجلات بعد التصفير
    for (const userId of allFinancialUserIds) {
      const user = await User.findById(userId);
      const financial = await Financial.findOne({ doctorId: userId });
      if (financial) {
        console.log(`  ${user?.fullName}: أرباح=${financial.totalEarnings}, مصاريف=${financial.totalExpenses}, معاملات=${financial.transactions.length}, ديون=${financial.debts.length}`);
      }
    }
    
    const paidApts = await Appointment.countDocuments({ ...appointmentFilter, isPaid: true });
    const debtApts = await Appointment.countDocuments({ ...appointmentFilter, debt: { $gt: 0 } });
    const paidLabs = await LabRequest.countDocuments({ ...labFilter, isPaid: true });
    
    console.log(`\n  مواعيد مدفوعة: ${paidApts}`);
    console.log(`  مواعيد عليها دين: ${debtApts}`);
    console.log(`  طلبات مختبر مدفوعة: ${paidLabs}`);
    
    console.log('\n✅ تم التصفير بنجاح! المرضى والتقارير لم تتأثر.');
    
  } catch (error) {
    console.error('\n❌ خطأ:', error.message);
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 تم قطع الاتصال بقاعدة البيانات');
    process.exit(0);
  }
}

// تشغيل السكريبت
resetAlshaabFinancials();
