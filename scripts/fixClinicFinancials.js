/**
 * سكريبت إصلاح الأرقام المالية للعيادة
 * =======================================
 * 
 * المشاكل اللي بيصلحها:
 * 1. totalEarnings مش مطابق لمجموع الـ transactions
 * 2. totalExpenses مش مطابق لمجموع الـ expenses  
 * 3. ديون مسجلة كـ paid بس لسا ظاهرة
 * 4. معاملات من المواعيد مسجلة عند الطبيب بس مش عند صاحب العيادة
 */

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ متصل بقاعدة البيانات'))
  .catch(err => { console.error('❌ خطأ في الاتصال:', err.message); process.exit(1); });

const User = require('../models/User');
const Clinic = require('../models/Clinic');
const Financial = require('../models/Financial');
const Appointment = require('../models/Appointment');
const LabRequest = require('../models/LabRequest');

async function fixClinicFinancials() {
  try {
    console.log('\n========================================');
    console.log('  إصلاح الأرقام المالية للعيادات');
    console.log('========================================\n');

    const clinics = await Clinic.find({});
    console.log(`📋 عدد العيادات: ${clinics.length}\n`);

    for (const clinic of clinics) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🏥 العيادة: ${clinic.name} (Owner: ${clinic.ownerId})`);
      console.log('='.repeat(60));

      const clinicOwnerId = clinic.ownerId;
      const doctorIds = clinic.doctors
        .filter(d => d.status === 'active')
        .map(d => d.doctorId);

      console.log(`👨‍⚕️ عدد الأطباء النشطين: ${doctorIds.length}`);

      // ==================== 1. إصلاح Financial لصاحب العيادة ====================
      let ownerFinancial = await Financial.findOne({ doctorId: clinicOwnerId });
      if (!ownerFinancial) {
        ownerFinancial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
        await ownerFinancial.save();
        console.log('  ⚠️ تم إنشاء سجل مالي جديد لصاحب العيادة');
      }

      const oldTotalEarnings = ownerFinancial.totalEarnings || 0;
      const oldTotalExpenses = ownerFinancial.totalExpenses || 0;

      // ==================== 2. حساب الإيرادات الحقيقية ====================

      // 2a. إيرادات المواعيد المدفوعة (من جميع أطباء العيادة)
      const paidAppointments = await Appointment.find({
        doctorId: { $in: doctorIds },
        isPaid: true,
        paymentAmount: { $gt: 0 }
      }).populate('patient', 'fullName');

      const appointmentIncome = paidAppointments.reduce((sum, apt) => sum + (apt.paymentAmount || 0), 0);
      console.log(`\n📊 المواعيد المدفوعة: ${paidAppointments.length} (المبلغ: ${appointmentIncome} ₪)`);

      // 2b. إيرادات طلبات المختبر المدفوعة
      const paidLabRequests = await LabRequest.find({
        doctorId: { $in: doctorIds },
        isPaid: true,
        paidAmount: { $gt: 0 }
      });
      const labIncome = paidLabRequests.reduce((sum, lab) => sum + (lab.paidAmount || lab.totalCost || 0), 0);
      console.log(`🔬 طلبات المختبر المدفوعة: ${paidLabRequests.length} (المبلغ: ${labIncome} ₪)`);

      // 2c. إيرادات من الـ transactions اللي مش مرتبطة بمواعيد (دفعات ديون يدوية)
      const manualTransactions = (ownerFinancial.transactions || []).filter(t => !t.appointmentId);
      const manualIncome = manualTransactions.reduce((sum, t) => sum + (t.amount || 0), 0);
      console.log(`💰 معاملات يدوية (بدون موعد): ${manualTransactions.length} (المبلغ: ${manualIncome} ₪)`);

      // ==================== 3. التأكد إنو كل موعد مدفوع عنده transaction ====================
      
      // Get existing appointment-linked transactions on owner's financial
      const existingAptTxnIds = new Set(
        (ownerFinancial.transactions || [])
          .filter(t => t.appointmentId)
          .map(t => t.appointmentId.toString())
      );

      // Also check doctor financials for appointment transactions
      const doctorFinancials = await Financial.find({ doctorId: { $in: doctorIds } });
      const doctorAptTxnIds = new Set();
      for (const df of doctorFinancials) {
        for (const t of (df.transactions || [])) {
          if (t.appointmentId) doctorAptTxnIds.add(t.appointmentId.toString());
        }
      }

      let missingTransactions = 0;
      for (const apt of paidAppointments) {
        const aptId = apt._id.toString();
        if (!existingAptTxnIds.has(aptId)) {
          // Transaction missing from owner's financial - add it
          ownerFinancial.transactions.push({
            amount: apt.paymentAmount || 0,
            description: `دفع موعد - ${apt.patient?.fullName || 'مريض'} - ${apt.reason || 'كشف'}`,
            date: apt.paidAt || apt.updatedAt || new Date(),
            patientId: apt.patient?._id || apt.patient,
            appointmentId: apt._id,
            paymentMethod: 'Cash'
          });
          missingTransactions++;
        }
      }
      if (missingTransactions > 0) {
        console.log(`  ⚠️ تم إضافة ${missingTransactions} معاملة مفقودة لصاحب العيادة`);
      }

      // ==================== 4. حساب الديون الحقيقية ====================
      
      // الديون المعلقة من Financial
      const pendingDebts = (ownerFinancial.debts || []).filter(d => d.status === 'pending');
      const totalPendingDebtsFromFinancial = pendingDebts.reduce((sum, d) => sum + (d.amount || 0), 0);
      
      // الديون من المواعيد (مواعيد فيها debt > 0)
      const unpaidAppointments = await Appointment.find({
        doctorId: { $in: doctorIds },
        debt: { $gt: 0 }
      }).populate('patient', 'fullName');
      const totalAppointmentDebts = unpaidAppointments.reduce((sum, a) => sum + (a.debt || 0), 0);
      
      console.log(`\n📋 ديون من Financial (pending): ${pendingDebts.length} (المبلغ: ${totalPendingDebtsFromFinancial} ₪)`);
      console.log(`📋 ديون من المواعيد (debt > 0): ${unpaidAppointments.length} (المبلغ: ${totalAppointmentDebts} ₪)`);

      // التأكد إنو كل موعد فيه دين عنده debt entry في Financial
      let missingDebts = 0;
      for (const apt of unpaidAppointments) {
        const aptId = apt._id.toString();
        const existingDebt = ownerFinancial.debts.find(d => 
          d.description && d.description.includes(aptId) && d.status === 'pending'
        );
        // Also check by patientId + approximate amount + date
        const existingDebtByPatient = ownerFinancial.debts.find(d =>
          d.patientId?.toString() === (apt.patient?._id || apt.patient)?.toString() &&
          d.status === 'pending' &&
          Math.abs((d.amount || 0) - (apt.debt || 0)) < 1
        );
        
        if (!existingDebt && !existingDebtByPatient) {
          ownerFinancial.debts.push({
            patientId: apt.patient?._id || apt.patient,
            doctorId: apt.doctorId,
            amount: apt.debt,
            description: `دين موعد - ${apt.patient?.fullName || 'مريض'} - ${aptId}`,
            date: apt.appointmentDateTime || new Date(),
            status: 'pending'
          });
          missingDebts++;
        }
      }
      if (missingDebts > 0) {
        console.log(`  ⚠️ تم إضافة ${missingDebts} دين مفقود`);
      }

      // تنظيف: حذف الديون المدفوعة (amount = 0 + status = paid)
      const beforeDebtCount = ownerFinancial.debts.length;
      ownerFinancial.debts = ownerFinancial.debts.filter(d => 
        !(d.status === 'paid' && (d.amount || 0) <= 0)
      );
      const removedDebts = beforeDebtCount - ownerFinancial.debts.length;
      if (removedDebts > 0) {
        console.log(`  🗑️ تم حذف ${removedDebts} دين مدفوع/صفري`);
      }

      // ==================== 5. إعادة حساب totalEarnings و totalExpenses ====================
      
      const actualTotalTransactions = (ownerFinancial.transactions || []).reduce((sum, t) => sum + (t.amount || 0), 0);
      const actualTotalExpenses = (ownerFinancial.expenses || []).reduce((sum, e) => sum + (e.amount || 0), 0);
      const actualTotalDebts = (ownerFinancial.debts || [])
        .filter(d => d.status === 'pending')
        .reduce((sum, d) => sum + (d.amount || 0), 0);

      console.log(`\n🔧 إصلاح الأرقام:`);
      console.log(`  totalEarnings: ${oldTotalEarnings} → ${actualTotalTransactions}`);
      console.log(`  totalExpenses: ${oldTotalExpenses} → ${actualTotalExpenses}`);
      console.log(`  totalDebts (pending): ${totalPendingDebtsFromFinancial} → ${actualTotalDebts}`);

      ownerFinancial.totalEarnings = actualTotalTransactions;
      ownerFinancial.totalExpenses = actualTotalExpenses;
      ownerFinancial.markModified('transactions');
      ownerFinancial.markModified('debts');
      ownerFinancial.markModified('expenses');
      await ownerFinancial.save();
      console.log('  ✅ تم حفظ سجل صاحب العيادة');

      // ==================== 6. إصلاح Financial لكل طبيب ====================
      for (const docId of doctorIds) {
        if (docId.toString() === clinicOwnerId.toString()) continue;
        
        const docFinancial = await Financial.findOne({ doctorId: docId });
        if (!docFinancial) continue;

        const docOldEarnings = docFinancial.totalEarnings || 0;
        const docActualEarnings = (docFinancial.transactions || []).reduce((sum, t) => sum + (t.amount || 0), 0);
        const docOldExpenses = docFinancial.totalExpenses || 0;
        const docActualExpenses = (docFinancial.expenses || []).reduce((sum, e) => sum + (e.amount || 0), 0);

        if (docOldEarnings !== docActualEarnings || docOldExpenses !== docActualExpenses) {
          const doctor = await User.findById(docId, 'fullName');
          console.log(`\n  👨‍⚕️ ${doctor?.fullName || docId}:`);
          console.log(`    totalEarnings: ${docOldEarnings} → ${docActualEarnings}`);
          console.log(`    totalExpenses: ${docOldExpenses} → ${docActualExpenses}`);
          
          docFinancial.totalEarnings = docActualEarnings;
          docFinancial.totalExpenses = docActualExpenses;
          await docFinancial.save();
          console.log('    ✅ تم الإصلاح');
        }
      }

      // ==================== 7. ملخص ====================
      const finalPendingDebts = (ownerFinancial.debts || [])
        .filter(d => d.status === 'pending');
      
      console.log(`\n📊 ملخص نهائي لـ ${clinic.name}:`);
      console.log(`  إجمالي الإيرادات: ${ownerFinancial.totalEarnings} ₪`);
      console.log(`  إجمالي المصاريف: ${ownerFinancial.totalExpenses} ₪`);
      console.log(`  صافي الربح: ${ownerFinancial.totalEarnings - ownerFinancial.totalExpenses} ₪`);
      console.log(`  عدد الديون المعلقة: ${finalPendingDebts.length}`);
      console.log(`  إجمالي الديون المعلقة: ${finalPendingDebts.reduce((s, d) => s + d.amount, 0)} ₪`);
      console.log(`  عدد المعاملات: ${ownerFinancial.transactions.length}`);
    }

    console.log('\n\n✅ تم الانتهاء من إصلاح جميع العيادات!');
    process.exit(0);
  } catch (error) {
    console.error('❌ خطأ:', error);
    process.exit(1);
  }
}

fixClinicFinancials();
