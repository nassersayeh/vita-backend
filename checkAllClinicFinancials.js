// checkAllClinicFinancials.js
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

  // Get all staff and doctors
  const staffUserIds = clinic.staff.map(s => s.userId);
  const doctorUserIds = clinic.doctors.map(d => d.doctorId);
  const allUserIds = [...staffUserIds, ...doctorUserIds, clinic.ownerId].filter(Boolean);

  // Get user details
  const users = await User.find({ _id: { $in: allUserIds } });
  const userMap = {};
  users.forEach(u => userMap[u._id] = u);

  // Get all financial records
  const financialRecords = await Financial.find({
    $or: [
      { doctorId: { $in: allUserIds } },
      { pharmacyId: { $in: allUserIds } }
    ]
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let totalTodayEarnings = 0;
  let totalMonthEarnings = 0;
  let totalDebts = 0;

  console.log(`📊 الحسابات المالية الكاملة:\n`);
  console.log('='.repeat(80));

  for (const record of financialRecords) {
    const userId = record.doctorId || record.pharmacyId;
    const user = userMap[userId];
    const userName = user ? user.fullName : 'Unknown';
    const userRole = user ? user.role : 'Unknown';

    console.log(`\n👤 ${userName} (${userRole})`);
    console.log(`   ID: ${userId}`);

    let userTodayEarnings = 0;
    let userMonthEarnings = 0;
    let userDebts = 0;

    // Transactions
    if (record.transactions && record.transactions.length > 0) {
      record.transactions.forEach(t => {
        const tDate = new Date(t.date);
        tDate.setHours(0, 0, 0, 0);
        userMonthEarnings += t.amount || 0;
        if (tDate.getTime() === today.getTime()) {
          userTodayEarnings += t.amount || 0;
        }
      });
    }

    // Debts
    if (record.debts && record.debts.length > 0) {
      const pendingDebts = record.debts.filter(d => d.status === 'pending');
      userDebts = pendingDebts.reduce((sum, d) => sum + (d.amount || 0), 0);
    }

    console.log(`   💰 إيرادات اليوم: ${userTodayEarnings} ₪`);
    console.log(`   💵 إيرادات الشهر: ${userMonthEarnings} ₪`);
    console.log(`   📋 الديون المستحقة: ${userDebts} ₪`);

    totalTodayEarnings += userTodayEarnings;
    totalMonthEarnings += userMonthEarnings;
    totalDebts += userDebts;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n📊 الملخص الإجمالي للمركز:`);
  console.log(`   💰 إيرادات اليوم: ${totalTodayEarnings} ₪`);
  console.log(`   💵 إيرادات الشهر: ${totalMonthEarnings} ₪`);
  console.log(`   📋 إجمالي الديون: ${totalDebts} ₪`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
