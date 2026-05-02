// checkPatientDebts.js
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

  // Phone numbers to check
  const phoneNumbers = ['0568661206', '0568532404'];
  
  // Patient names to check
  const patientNames = ['فادي علي ابو زيد', 'محمد جمال ابراهيم ابو زيد', 'هديل فايز درويش'];

  console.log('🔍 البحث عن المرضى:\n');

  // Find patients by phone or name
  const patients = await User.find({
    $or: [
      { mobileNumber: { $in: phoneNumbers } },
      { fullName: { $in: patientNames } }
    ],
    role: 'User'
  });

  if (patients.length === 0) {
    console.log('❌ لم يتم العثور على أي مرضى بهذه الأرقام أو الأسماء\n');
  } else {
    console.log(`✅ تم العثور على ${patients.length} مريض(ة):\n`);
    patients.forEach(p => {
      console.log(`👤 ${p.fullName}`);
      console.log(`   📱 رقم الهاتف: ${p.mobileNumber}`);
      console.log(`   ID: ${p._id}\n`);
    });
  }

  // Get all staff and doctors
  const staffUserIds = clinic.staff.map(s => s.userId);
  const doctorUserIds = clinic.doctors.map(d => d.doctorId);
  const allUserIds = [...staffUserIds, ...doctorUserIds, clinic.ownerId].filter(Boolean);

  // Get all financial records
  const financialRecords = await Financial.find({
    $or: [
      { doctorId: { $in: allUserIds } },
      { pharmacyId: { $in: allUserIds } }
    ]
  });

  console.log('📊 البحث عن الديون والعمليات المالية:\n');

  let foundDebts = false;
  let foundTransactions = false;
  let totalFoundDebts = 0;
  let totalFoundTransactions = 0;

  for (const record of financialRecords) {
    // Check debts
    if (record.debts && record.debts.length > 0) {
      const relatedDebts = record.debts.filter(d => 
        patients.some(p => p._id.toString() === d.patientId?.toString())
      );

      if (relatedDebts.length > 0) {
        foundDebts = true;
        console.log(`\n💳 ديون مرتبطة بالمرضى (من حساب ${record.doctorId || record.pharmacyId}):`);
        relatedDebts.forEach(d => {
          const patient = patients.find(p => p._id.toString() === d.patientId?.toString());
          const status = d.status === 'pending' ? '⏳ مستحقة' : '✅ مدفوعة';
          console.log(`   • ${patient?.fullName || 'مريض'}: ${d.amount} ₪ - ${status} (${d.description || 'ديون'})`);
          if (d.status === 'pending') {
            totalFoundDebts += d.amount || 0;
          }
        });
      }
    }

    // Check transactions
    if (record.transactions && record.transactions.length > 0) {
      const relatedTransactions = record.transactions.filter(t => 
        patients.some(p => p._id.toString() === t.patientId?.toString())
      );

      if (relatedTransactions.length > 0) {
        foundTransactions = true;
        console.log(`\n💰 عمليات إيراد مرتبطة بالمرضى (من حساب ${record.doctorId || record.pharmacyId}):`);
        relatedTransactions.forEach(t => {
          const patient = patients.find(p => p._id.toString() === t.patientId?.toString());
          const tDate = new Date(t.date).toLocaleDateString('ar-SA');
          console.log(`   • ${patient?.fullName || 'مريض'}: ${t.amount} ₪ (${tDate}) - ${t.description || 'خدمة'}`);
          totalFoundTransactions += t.amount || 0;
        });
      }
    }
  }

  if (!foundDebts && !foundTransactions) {
    console.log('⚠️ لم يتم العثور على أي ديون أو عمليات مرتبطة بهؤلاء المرضى');
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\n📋 الملخص:`);
  console.log(`   - إجمالي الديون المستحقة: ${totalFoundDebts} ₪`);
  console.log(`   - إجمالي العمليات المالية: ${totalFoundTransactions} ₪`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
