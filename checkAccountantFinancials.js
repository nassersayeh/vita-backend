// checkAccountantFinancials.js
const mongoose = require('mongoose');
const Clinic = require('./models/Clinic');
const Financial = require('./models/Financial');
const User = require('./models/User');

const MONGODB_URI = 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');

  // Find the clinic
  const clinic = await Clinic.findOne({ name: 'مستوصف الشعب الطبي' });
  if (!clinic) {
    console.error('❌ لم يتم العثور على المركز');
    process.exit(1);
  }

  console.log(`📍 المركز: ${clinic.name}\n`);

  // Find the accountant (Accountant staff member)
  const accountantStaff = clinic.staff.find(s => s.role === 'Accountant');
  if (!accountantStaff) {
    console.error('❌ لم يتم العثور على محاسب');
    process.exit(1);
  }

  const accountantUser = await User.findById(accountantStaff.userId);
  console.log(`👤 المحاسب: ${accountantUser.fullName}\n`);

  // Get financial records for the accountant
  const financialRecords = await Financial.find({
    $or: [
      { doctorId: accountantStaff.userId },
      { pharmacyId: accountantStaff.userId }
    ]
  });

  console.log(`📊 السجلات المالية للمحاسب:\n`);
  
  let totalEarnings = 0;
  let todayEarnings = 0;
  let totalDebts = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const record of financialRecords) {
    console.log(`📄 الحساب ID: ${record._id}`);
    
    // Transactions (إيرادات)
    console.log(`\n   💰 الإيرادات:`);
    console.log(`      - إجمالي: ${record.totalEarnings} ₪`);
    
    if (record.transactions && record.transactions.length > 0) {
      let monthEarnings = 0;
      let todayTransactions = 0;

      record.transactions.forEach(t => {
        const tDate = new Date(t.date);
        tDate.setHours(0, 0, 0, 0);
        monthEarnings += t.amount || 0;
        if (tDate.getTime() === today.getTime()) {
          todayTransactions += t.amount || 0;
        }
      });

      console.log(`      - إيرادات اليوم: ${todayTransactions} ₪`);
      console.log(`      - إيرادات هذا الشهر: ${monthEarnings} ₪`);
      console.log(`      - عدد العمليات: ${record.transactions.length}`);
      
      totalEarnings += monthEarnings;
      todayEarnings += todayTransactions;
    }

    // Expenses (مصروفات)
    console.log(`\n   📤 المصروفات:`);
    console.log(`      - إجمالي: ${record.totalExpenses} ₪`);
    if (record.expenses && record.expenses.length > 0) {
      console.log(`      - عدد العمليات: ${record.expenses.length}`);
      record.expenses.slice(0, 3).forEach(e => {
        console.log(`        • ${e.description}: ${e.amount} ₪`);
      });
    }

    // Debts (الديون)
    console.log(`\n   📋 الديون:`);
    if (record.debts && record.debts.length > 0) {
      const pendingDebts = record.debts.filter(d => d.status === 'pending');
      const paidDebts = record.debts.filter(d => d.status === 'paid');
      
      const totalPendingDebts = pendingDebts.reduce((sum, d) => sum + (d.amount || 0), 0);
      const totalPaidDebts = paidDebts.reduce((sum, d) => sum + (d.amount || 0), 0);

      console.log(`      - ديون مستحقة: ${totalPendingDebts} ₪ (${pendingDebts.length} ديون)`);
      console.log(`      - ديون مدفوعة: ${totalPaidDebts} ₪ (${paidDebts.length} ديون)`);
      
      totalDebts += totalPendingDebts;

      if (pendingDebts.length > 0) {
        console.log(`\n      تفاصيل الديون المستحقة:`);
        pendingDebts.slice(0, 5).forEach((d, idx) => {
          const debtDate = new Date(d.date).toLocaleDateString('ar-SA');
          console.log(`        ${idx + 1}. ${d.description || 'ديون'} - ${d.amount} ₪ (${debtDate})`);
        });
      }
    } else {
      console.log(`      - لا توجد ديون`);
    }

    console.log('\n' + '='.repeat(60) + '\n');
  }

  console.log(`📊 الملخص الإجمالي للمحاسب:`);
  console.log(`   - إيرادات اليوم: ${todayEarnings} ₪`);
  console.log(`   - إيرادات الشهر: ${totalEarnings} ₪`);
  console.log(`   - إجمالي الديون المستحقة: ${totalDebts} ₪`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
