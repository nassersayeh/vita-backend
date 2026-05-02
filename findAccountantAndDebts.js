// findAccountantAndDebts.js
const mongoose = require('mongoose');
const Clinic = require('./models/Clinic');
const Financial = require('./models/Financial');
const User = require('./models/User');

const MONGODB_URI = 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');

  // Find user by phone number
  const accountantPhone = '0594540648';
  const accountant = await User.findOne({ mobileNumber: accountantPhone });
  
  if (!accountant) {
    console.error(`❌ لم يتم العثور على مستخدم برقم ${accountantPhone}`);
    process.exit(1);
  }

  console.log(`✅ تم العثور على: ${accountant.fullName}`);
  console.log(`   الدور: ${accountant.role}`);
  console.log(`   ID: ${accountant._id}\n`);

  // Find clinic for this accountant
  const clinic = await Clinic.findOne({
    $or: [
      { 'staff.userId': accountant._id },
      { ownerId: accountant._id }
    ]
  });

  if (clinic) {
    console.log(`✅ المركز: ${clinic.name}`);
    console.log(`   ID: ${clinic._id}\n`);
  }

  // Get all financial records
  const allFinancials = await Financial.find();
  
  console.log(`📊 البحث في جميع السجلات المالية:\n`);

  let totalEarnings = 0;
  let totalDebts = 0;
  let totalExpenses = 0;

  for (const record of allFinancials) {
    let hasRelevantData = false;

    // Check if this record belongs to the accountant
    if (record.doctorId?.toString() === accountant._id.toString() || 
        record.pharmacyId?.toString() === accountant._id.toString()) {
      hasRelevantData = true;
      console.log(`\n📄 السجل المالي الخاص بالمحاسب:`);
      console.log(`   ID: ${record._id}`);
      console.log(`   doctorId: ${record.doctorId}`);
      console.log(`   pharmacyId: ${record.pharmacyId}`);
    }

    // Check debts related to accountant's clinic
    if (clinic && record.debts && record.debts.length > 0) {
      // Check if this record belongs to the clinic
      const doctor = await User.findById(record.doctorId);
      if (doctor && doctor.clinicId?.toString() === clinic._id.toString()) {
        hasRelevantData = true;
        if (!hasRelevantData) {
          console.log(`\n📄 سجل مالي لطبيب في نفس المركز:`);
          console.log(`   الطبيب: ${doctor.fullName}`);
          console.log(`   ID: ${record._id}`);
        }

        const pendingDebts = record.debts.filter(d => d.status === 'pending');
        const pendingTotal = pendingDebts.reduce((sum, d) => sum + (d.amount || 0), 0);
        
        if (pendingTotal > 0) {
          console.log(`   ديون مستحقة: ${pendingTotal} ₪`);
          totalDebts += pendingTotal;
        }
      }
    }

    // Earnings and expenses
    if (hasRelevantData) {
      console.log(`   إجمالي الإيرادات: ${record.totalEarnings} ₪`);
      console.log(`   إجمالي المصروفات: ${record.totalExpenses} ₪`);
      
      if (record.transactions && record.transactions.length > 0) {
        console.log(`   عدد العمليات: ${record.transactions.length}`);
        record.transactions.forEach((t, idx) => {
          console.log(`     ${idx + 1}. ${t.description}: ${t.amount} ₪ (${new Date(t.date).toLocaleDateString('ar-SA')})`);
        });
      }

      if (record.debts && record.debts.length > 0) {
        const pendingDebts = record.debts.filter(d => d.status === 'pending');
        console.log(`   عدد الديون المستحقة: ${pendingDebts.length}`);
        pendingDebts.slice(0, 3).forEach((d, idx) => {
          console.log(`     ${idx + 1}. ${d.description}: ${d.amount} ₪`);
        });
      }

      totalEarnings += record.totalEarnings || 0;
      totalExpenses += record.totalExpenses || 0;
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n📋 الملخص:`);
  console.log(`   إجمالي الإيرادات: ${totalEarnings} ₪`);
  console.log(`   إجمالي المصروفات: ${totalExpenses} ₪`);
  console.log(`   إجمالي الديون: ${totalDebts} ₪`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
