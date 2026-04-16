/**
 * سكريبت إصلاح إيرادات الأطباء وديون المحاسب
 * =============================================
 * 
 * 1. يضيف transactions مفقودة للأطباء من المواعيد المدفوعة
 * 2. يصلح totalEarnings لكل طبيب
 * 3. يحذف الديون المكررة
 */

const mongoose = require('mongoose');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ متصل بقاعدة البيانات'))
  .catch(err => { console.error('❌ خطأ:', err.message); process.exit(1); });

const User = require('../models/User');
const Clinic = require('../models/Clinic');
const Financial = require('../models/Financial');
const Appointment = require('../models/Appointment');
const LabRequest = require('../models/LabRequest');

async function fixAll() {
  try {
    const clinics = await Clinic.find({});
    
    for (const clinic of clinics) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🏥 ${clinic.name}`);
      console.log('='.repeat(60));

      const clinicOwnerId = clinic.ownerId;
      const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
      const clinicPercentageMap = {};
      for (const doc of clinic.doctors.filter(d => d.status === 'active')) {
        clinicPercentageMap[doc.doctorId.toString()] = doc.clinicPercentage || 0;
      }

      // ==================== 1. إصلاح إيرادات الأطباء ====================
      console.log('\n📊 إصلاح إيرادات الأطباء...');
      
      for (const doctorId of doctorIds) {
        const doctor = await User.findById(doctorId, 'fullName');
        const doctorName = doctor?.fullName || doctorId;
        
        // Get all paid appointments for this doctor
        const paidApts = await Appointment.find({
          doctorId: doctorId,
          isPaid: true,
          paymentAmount: { $gt: 0 }
        }).populate('patient', 'fullName');

        if (paidApts.length === 0) continue;

        let docFinancial = await Financial.findOne({ doctorId: doctorId });
        if (!docFinancial) {
          docFinancial = new Financial({ doctorId: doctorId, totalEarnings: 0, totalExpenses: 0, transactions: [], debts: [], expenses: [] });
        }

        // Get existing appointment transaction IDs
        const existingAptIds = new Set(
          (docFinancial.transactions || [])
            .filter(t => t.appointmentId)
            .map(t => t.appointmentId.toString())
        );

        let addedCount = 0;
        let addedAmount = 0;
        const clinicPct = clinicPercentageMap[doctorId.toString()] || 0;

        for (const apt of paidApts) {
          if (existingAptIds.has(apt._id.toString())) continue;

          // Calculate doctor's share
          const totalPayment = apt.paymentAmount || 0;
          const doctorShare = clinicPct > 0 
            ? totalPayment - Math.round(totalPayment * clinicPct / 100)
            : totalPayment;

          docFinancial.transactions.push({
            amount: doctorShare,
            description: `دفع موعد - ${apt.patient?.fullName || 'مريض'} - ${apt.reason || 'كشف'}`,
            date: apt.paidAt || apt.updatedAt || new Date(),
            patientId: apt.patient?._id || apt.patient,
            appointmentId: apt._id,
            paymentMethod: 'Cash'
          });
          addedCount++;
          addedAmount += doctorShare;
        }

        if (addedCount > 0) {
          // Recalculate totalEarnings from all transactions
          docFinancial.totalEarnings = (docFinancial.transactions || []).reduce((sum, t) => sum + (t.amount || 0), 0);
          docFinancial.markModified('transactions');
          await docFinancial.save();
          console.log(`  ✅ ${doctorName}: +${addedCount} معاملات (+${addedAmount} ₪) → totalEarnings: ${docFinancial.totalEarnings} ₪`);
        }
      }

      // ==================== 2. إصلاح صاحب العيادة ====================
      console.log('\n📊 إصلاح سجل صاحب العيادة...');
      
      let ownerFinancial = await Financial.findOne({ doctorId: clinicOwnerId });
      if (!ownerFinancial) continue;

      // Check for missing appointment transactions on owner
      const allPaidApts = await Appointment.find({
        doctorId: { $in: doctorIds },
        isPaid: true,
        paymentAmount: { $gt: 0 }
      }).populate('patient', 'fullName');

      const ownerExistingAptIds = new Set(
        (ownerFinancial.transactions || [])
          .filter(t => t.appointmentId)
          .map(t => t.appointmentId.toString())
      );

      let ownerAdded = 0;
      for (const apt of allPaidApts) {
        if (ownerExistingAptIds.has(apt._id.toString())) continue;
        
        ownerFinancial.transactions.push({
          amount: apt.paymentAmount || 0,
          description: `دفع موعد - ${apt.patient?.fullName || 'مريض'} - ${apt.reason || 'كشف'}`,
          date: apt.paidAt || apt.updatedAt || new Date(),
          patientId: apt.patient?._id || apt.patient,
          appointmentId: apt._id,
          paymentMethod: 'Cash'
        });
        ownerAdded++;
      }
      if (ownerAdded > 0) {
        console.log(`  ⚠️ تم إضافة ${ownerAdded} معاملة مفقودة لصاحب العيادة`);
      }

      // ==================== 3. إصلاح الديون المكررة ====================
      console.log('\n📊 إصلاح الديون المكررة...');
      
      const pendingDebts = (ownerFinancial.debts || []).filter(d => d.status === 'pending');
      const seenDebts = new Map();
      const duplicateIds = [];
      
      for (const debt of pendingDebts) {
        // Key: patientId + description + amount
        const key = `${debt.patientId?.toString() || ''}_${debt.description}_${debt.amount}`;
        if (seenDebts.has(key)) {
          duplicateIds.push(debt._id);
          const patient = await User.findById(debt.patientId, 'fullName');
          console.log(`  🗑️ حذف دين مكرر: ${patient?.fullName || 'مجهول'} - ${debt.amount} ₪ - ${debt.description}`);
        } else {
          seenDebts.set(key, debt._id);
        }
      }

      if (duplicateIds.length > 0) {
        ownerFinancial.debts = ownerFinancial.debts.filter(d => 
          !duplicateIds.some(id => id.toString() === d._id.toString())
        );
      }

      // Recalculate totalEarnings
      ownerFinancial.totalEarnings = (ownerFinancial.transactions || []).reduce((sum, t) => sum + (t.amount || 0), 0);
      ownerFinancial.totalExpenses = (ownerFinancial.expenses || []).reduce((sum, e) => sum + (e.amount || 0), 0);
      ownerFinancial.markModified('transactions');
      ownerFinancial.markModified('debts');
      await ownerFinancial.save();

      // ==================== 4. ملخص ====================
      const finalPending = ownerFinancial.debts.filter(d => d.status === 'pending');
      console.log(`\n📋 ملخص نهائي:`);
      console.log(`  إيرادات صاحب العيادة: ${ownerFinancial.totalEarnings} ₪`);
      console.log(`  معاملات: ${ownerFinancial.transactions.length}`);
      console.log(`  ديون معلقة: ${finalPending.length} (${finalPending.reduce((s,d) => s + d.amount, 0)} ₪)`);
      
      console.log('\n  إيرادات الأطباء:');
      for (const did of doctorIds) {
        const doc = await User.findById(did, 'fullName');
        const fin = await Financial.findOne({ doctorId: did });
        const txnSum = (fin?.transactions || []).reduce((s,t) => s + t.amount, 0);
        console.log(`    ${doc?.fullName}: ${txnSum} ₪ (${fin?.transactions?.length || 0} معاملات)`);
      }
      
      console.log('\n  الديون المعلقة:');
      for (const d of finalPending) {
        const patient = await User.findById(d.patientId, 'fullName');
        console.log(`    ${patient?.fullName || 'مجهول'}: ${d.amount} ₪ - ${d.description}`);
      }
    }

    console.log('\n\n✅ تم الانتهاء!');
    process.exit(0);
  } catch (error) {
    console.error('❌ خطأ:', error);
    process.exit(1);
  }
}

fixAll();
