// resetAccountsForShaabClinic.js
// Script to reset all financial accounts for "مستوصف الشعب" (Shaab Clinic) to zero
// Run this script with: node resetAccountsForShaabClinic.js

const mongoose = require('mongoose');
const Financial = require('./models/Financial');
const Clinic = require('./models/Clinic');
const User = require('./models/User');
const Appointment = require('./models/Appointment');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  // Find the clinic by name
  const clinic = await Clinic.findOne({ name: 'مستوصف الشعب الطبي' });
  if (!clinic) {
    console.error('❌ لم يتم العثور على مستوصف الشعب الطبي');
    process.exit(1);
  }
  console.log('✅ Found clinic:', clinic.name, clinic._id);

  // Get all user IDs for doctors, nurses, accountants, lab techs in this clinic
  const staffUserIds = clinic.staff.map(s => s.userId);
  const doctorUserIds = clinic.doctors.map(d => d.doctorId);
  const allUserIds = [...staffUserIds, ...doctorUserIds, clinic.ownerId].filter(Boolean);

  // Get current month date range (from 1st to last day of current month)
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  console.log(`\n📅 تصفير الحسابات من ${firstDayOfMonth.toLocaleDateString('ar-SA')} إلى ${lastDayOfMonth.toLocaleDateString('ar-SA')}\n`);

  // 1. Clear current month transactions and expenses for these users
  const financialDocs = await Financial.find({
    $or: [
      { doctorId: { $in: allUserIds } },
      { pharmacyId: { $in: allUserIds } }
    ]
  });

  let totalTransactionsRemoved = 0;
  let totalExpensesRemoved = 0;
  let totalDebtsRemoved = 0;

  for (const doc of financialDocs) {
    // Filter transactions from current month
    const transactionsToRemove = doc.transactions.filter(t => {
      const tDate = new Date(t.date);
      return tDate >= firstDayOfMonth && tDate <= lastDayOfMonth;
    });
    
    // Filter expenses from current month
    const expensesToRemove = doc.expenses.filter(e => {
      const eDate = new Date(e.date);
      return eDate >= firstDayOfMonth && eDate <= lastDayOfMonth;
    });
    
    // Filter debts from current month
    const debtsToRemove = doc.debts.filter(d => {
      const dDate = new Date(d.date);
      return dDate >= firstDayOfMonth && dDate <= lastDayOfMonth;
    });

    // Remove these items
    doc.transactions = doc.transactions.filter(t => {
      const tDate = new Date(t.date);
      return !(tDate >= firstDayOfMonth && tDate <= lastDayOfMonth);
    });
    
    doc.expenses = doc.expenses.filter(e => {
      const eDate = new Date(e.date);
      return !(eDate >= firstDayOfMonth && eDate <= lastDayOfMonth);
    });
    
    doc.debts = doc.debts.filter(d => {
      const dDate = new Date(d.date);
      return !(dDate >= firstDayOfMonth && dDate <= lastDayOfMonth);
    });

    // Recalculate totals
    const transactionAmount = doc.transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    const expenseAmount = doc.expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    
    doc.totalEarnings = transactionAmount;
    doc.totalExpenses = expenseAmount;

    await doc.save();

    totalTransactionsRemoved += transactionsToRemove.length;
    totalExpensesRemoved += expensesToRemove.length;
    totalDebtsRemoved += debtsToRemove.length;

    console.log(`  📄 ${doc.doctorId || doc.pharmacyId}:`);
    console.log(`     - تم حذف ${transactionsToRemove.length} عملية إيراد`);
    console.log(`     - تم حذف ${expensesToRemove.length} عملية مصروف`);
    console.log(`     - تم حذف ${debtsToRemove.length} ديون مستحقة`);
  }

  console.log(`\n✅ ملخص العمليات في جدول Financial:`);
  console.log(`   - إجمالي الإيرادات المحذوفة: ${totalTransactionsRemoved}`);
  console.log(`   - إجمالي المصروفات المحذوفة: ${totalExpensesRemoved}`);
  console.log(`   - إجمالي الديون المحذوفة: ${totalDebtsRemoved}`);

  // 2. Clear Appointments for this month
  console.log(`\n📋 تصفير جدول المواعيد (Appointments):\n`);
  
  const appointments = await Appointment.find({ doctorId: { $in: doctorUserIds } });
  
  let appointmentsRemoved = 0;
  let debtsRemoved = 0;
  let paymentsRemoved = 0;

  for (const appointment of appointments) {
    // Check if this appointment is from the current month
    const appointmentDate = new Date(appointment.updatedAt || appointment.createdAt);
    appointmentDate.setHours(0, 0, 0, 0);
    
    const isCurrentMonth = appointmentDate >= firstDayOfMonth && appointmentDate <= lastDayOfMonth;

    if (isCurrentMonth) {
      if (appointment.debt > 0) {
        debtsRemoved += appointment.debt;
      }
      if (appointment.isPaid && appointment.paymentAmount > 0) {
        paymentsRemoved += appointment.paymentAmount;
      }

      // Reset the appointment payments and debts
      appointment.isPaid = false;
      appointment.paymentAmount = 0;
      appointment.debt = 0;
      appointment.paidAt = null;
      
      await appointment.save();
      appointmentsRemoved++;
    }
  }

  console.log(`  📄 المواعيد المصفرة: ${appointmentsRemoved}`);
  console.log(`     - المدفوعات المحذوفة: ${paymentsRemoved} ₪`);
  console.log(`     - الديون المحذوفة: ${debtsRemoved} ₪`);

  console.log(`\n🎉 تم تصفير جميع الحسابات المالية بنجاح لمستوصف الشعب الطبي!`);
  console.log(`\n📊 الملخص الإجمالي:`);
  console.log(`   ✅ Financial جدول: ${totalTransactionsRemoved} إيرادات، ${totalExpensesRemoved} مصروفات، ${totalDebtsRemoved} ديون`);
  console.log(`   ✅ Appointments جدول: ${appointmentsRemoved} موعد، ${paymentsRemoved} ₪ مدفوعات، ${debtsRemoved} ₪ ديون`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
