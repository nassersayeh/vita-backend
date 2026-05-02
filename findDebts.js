// findDebts.js
const mongoose = require('mongoose');
const Appointment = require('./models/Appointment');
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

  // Get all doctor IDs
  const doctorIds = clinic.doctors.map(d => d.doctorId);

  // Find appointments with debt
  const appointmentsWithDebt = await Appointment.find({
    doctorId: { $in: doctorIds },
    debt: { $gt: 0 }
  });

  console.log(`📋 المواعيد مع ديون:\n`);
  console.log(`عدد المواعيد: ${appointmentsWithDebt.length}\n`);

  let totalDebts = 0;

  appointmentsWithDebt.forEach((a, idx) => {
    console.log(`${idx + 1}. الموعد:`);
    console.log(`   ID: ${a._id}`);
    console.log(`   الطبيب: ${a.doctorId}`);
    console.log(`   الدين: ${a.debt} ₪`);
    console.log(`   التاريخ المحدث: ${new Date(a.updatedAt).toLocaleDateString('ar-SA')}`);
    console.log(`   التاريخ المنشأ: ${new Date(a.createdAt).toLocaleDateString('ar-SA')}`);
    console.log(`   تاريخ الدفع: ${a.paidAt ? new Date(a.paidAt).toLocaleDateString('ar-SA') : 'لا يوجد'}`);
    console.log('');
    
    totalDebts += a.debt;
  });

  console.log(`\n💰 إجمالي الديون: ${totalDebts} ₪`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
