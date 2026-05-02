// checkAppointmentAndFinancialData.js
const mongoose = require('mongoose');
const Appointment = require('./models/Appointment');
const Financial = require('./models/Financial');
const Clinic = require('./models/Clinic');
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

  console.log(`📍 المركز: ${clinic.name}`);
  console.log(`   ID: ${clinic._id}\n`);

  // Get all doctor IDs
  const doctorIds = clinic.doctors.map(d => d.doctorId);

  console.log(`🔍 البحث في جداول البيانات:\n`);

  // Check Appointments
  console.log('📋 المواعيد (Appointments):');
  const appointments = await Appointment.find({ doctorId: { $in: doctorIds } });
  console.log(`   إجمالي المواعيد: ${appointments.length}`);

  if (appointments.length > 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAppointments = appointments.filter(a => {
      const aDate = new Date(a.paidAt || a.updatedAt);
      aDate.setHours(0, 0, 0, 0);
      return aDate.getTime() === today.getTime();
    });

    const paidAppointments = appointments.filter(a => a.isPaid && a.paymentAmount > 0);
    const withDebt = appointments.filter(a => a.debt > 0);

    console.log(`   - المواعيد المدفوعة: ${paidAppointments.length}`);
    console.log(`   - المواعيد مع ديون: ${withDebt.length}`);
    console.log(`   - المواعيد اليوم: ${todayAppointments.length}`);

    console.log(`\n   تفاصيل المواعيد:`);
    appointments.slice(0, 5).forEach((a, idx) => {
      console.log(`     ${idx + 1}. المريض: ${a.patientId}`);
      console.log(`        المبلغ: ${a.paymentAmount} ₪ - الديون: ${a.debt} ₪`);
      console.log(`        مدفوعة: ${a.isPaid ? 'نعم' : 'لا'}`);
      console.log(`        التاريخ: ${new Date(a.updatedAt).toLocaleDateString('ar-SA')}`);
    });
  }

  // Check Financial records
  console.log(`\n\n💰 السجلات المالية (Financial):`);
  const financials = await Financial.find({
    $or: [
      { doctorId: { $in: doctorIds } },
      { pharmacyId: { $in: doctorIds } }
    ]
  });

  console.log(`   إجمالي السجلات: ${financials.length}`);

  if (financials.length > 0) {
    financials.forEach((f, idx) => {
      console.log(`\n   ${idx + 1}. السجل:`);
      console.log(`      doctorId: ${f.doctorId}`);
      console.log(`      pharmacyId: ${f.pharmacyId}`);
      console.log(`      إجمالي الإيرادات: ${f.totalEarnings} ₪`);
      console.log(`      عدد العمليات: ${f.transactions?.length || 0}`);
      console.log(`      عدد الديون: ${f.debts?.length || 0}`);

      if (f.transactions && f.transactions.length > 0) {
        console.log(`\n      العمليات:`);
        f.transactions.slice(0, 3).forEach((t, tIdx) => {
          const tDate = new Date(t.date).toLocaleDateString('ar-SA');
          console.log(`        ${tIdx + 1}. ${t.description}: ${t.amount} ₪ (${tDate})`);
        });
      }

      if (f.debts && f.debts.length > 0) {
        const pendingDebts = f.debts.filter(d => d.status === 'pending');
        const totalPendingDebts = pendingDebts.reduce((sum, d) => sum + (d.amount || 0), 0);
        
        console.log(`\n      الديون المستحقة: ${totalPendingDebts} ₪`);
        pendingDebts.slice(0, 3).forEach((d, dIdx) => {
          console.log(`        ${dIdx + 1}. ${d.description}: ${d.amount} ₪`);
        });
      }
    });
  }

  // Calculate totals like the API does
  console.log(`\n\n📊 الملخص (كما يحسبه الـ API):\n`);

  let todayRevenue = 0;
  let monthRevenue = 0;
  let totalDebts = 0;

  // From appointments
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const todayPaidAppointments = appointments.filter(a => {
    if (!a.isPaid) return false;
    const aDate = new Date(a.paidAt || a.updatedAt);
    aDate.setHours(0, 0, 0, 0);
    return aDate.getTime() === today.getTime();
  });

  const monthPaidAppointments = appointments.filter(a => {
    if (!a.isPaid) return false;
    const aDate = new Date(a.paidAt || a.updatedAt);
    return aDate >= firstOfMonth && aDate <= lastOfMonth;
  });

  const appointmentDebts = appointments.reduce((sum, a) => sum + (a.debt || 0), 0);

  todayRevenue = todayPaidAppointments.reduce((sum, a) => sum + (a.paymentAmount || 0), 0);
  monthRevenue = monthPaidAppointments.reduce((sum, a) => sum + (a.paymentAmount || 0), 0);
  totalDebts = appointmentDebts;

  console.log(`إيرادات اليوم: ${todayRevenue} ₪`);
  console.log(`إيرادات الشهر: ${monthRevenue} ₪`);
  console.log(`إجمالي الديون: ${totalDebts} ₪`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
