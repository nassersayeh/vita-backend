// checkPharmacyFinancials.js
const mongoose = require('mongoose');
const PharmacyFinancial = require('./models/PharmacyFinancial');
const User = require('./models/User');
const Clinic = require('./models/Clinic');

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

  console.log(`📍 المركز: ${clinic.name}`);
  console.log(`   ID: ${clinic._id}\n`);

  // Get all staff and doctors IDs
  const staffUserIds = clinic.staff.map(s => s.userId);
  const doctorUserIds = clinic.doctors.map(d => d.doctorId);
  const allUserIds = [...staffUserIds, ...doctorUserIds, clinic.ownerId].filter(Boolean);

  // Get all users
  const users = await User.find({ _id: { $in: allUserIds } });
  const userMap = {};
  users.forEach(u => userMap[u._id] = u);

  console.log('📊 البحث في جداول الأموال:\n');

  // Search PharmacyFinancial
  const pharmacyFinancials = await PharmacyFinancial.find({
    pharmacyId: { $in: allUserIds }
  });

  console.log(`تم العثور على ${pharmacyFinancials.length} سجل في PharmacyFinancial\n`);

  let totalEarnings = 0;
  let totalDebts = 0;
  let totalExpenses = 0;

  for (const record of pharmacyFinancials) {
    const user = userMap[record.pharmacyId];
    console.log(`\n📄 ${user?.fullName || 'Unknown'} (${user?.role})`);
    console.log(`   ID: ${record.pharmacyId}`);
    console.log(`   إجمالي الإيرادات: ${record.totalRevenue} ₪`);
    console.log(`   إجمالي المصروفات: ${record.totalExpenses} ₪`);
    console.log(`   رصيد الحساب: ${record.accountBalance} ₪`);
    console.log(`   إجمالي الديون: ${record.totalDebts} ₪`);

    if (record.transactions && record.transactions.length > 0) {
      console.log(`   عدد العمليات: ${record.transactions.length}`);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayTransactions = record.transactions.filter(t => {
        const tDate = new Date(t.date);
        tDate.setHours(0, 0, 0, 0);
        return tDate.getTime() === today.getTime();
      });

      const monthlyTransactions = record.transactions.filter(t => {
        const tDate = new Date(t.date);
        return tDate.getMonth() === new Date().getMonth() && 
               tDate.getFullYear() === new Date().getFullYear();
      });

      const todayIncome = todayTransactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + (t.amount || 0), 0);
      
      const monthlyIncome = monthlyTransactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      console.log(`   إيرادات اليوم: ${todayIncome} ₪`);
      console.log(`   إيرادات الشهر: ${monthlyIncome} ₪`);
      console.log(`   أول 3 عمليات:`);
      
      record.transactions.slice(0, 3).forEach((t, idx) => {
        const tDate = new Date(t.date).toLocaleDateString('ar-SA');
        console.log(`     ${idx + 1}. ${t.type} - ${t.category}: ${t.amount} ₪ (${tDate})`);
      });
    }

    if (record.debts && record.debts.length > 0) {
      console.log(`   عدد الديون: ${record.debts.length}`);
      const pendingDebts = record.debts.filter(d => d.status === 'pending');
      console.log(`   ديون مستحقة: ${pendingDebts.length}`);
      
      pendingDebts.slice(0, 3).forEach((d, idx) => {
        console.log(`     ${idx + 1}. ${d.patientName}: ${d.amount} ₪`);
      });
    }

    totalEarnings += record.totalRevenue || 0;
    totalDebts += record.totalDebts || 0;
    totalExpenses += record.totalExpenses || 0;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n📋 الملخص الإجمالي:`);
  console.log(`   إجمالي الإيرادات: ${totalEarnings} ₪`);
  console.log(`   إجمالي المصروفات: ${totalExpenses} ₪`);
  console.log(`   إجمالي الديون: ${totalDebts} ₪`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
