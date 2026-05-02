// searchAllDebts.js
const mongoose = require('mongoose');
const Financial = require('./models/Financial');

const MONGODB_URI = 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');

  // Get all financial records with debts
  const financialRecords = await Financial.find({ debts: { $exists: true, $ne: [] } });

  console.log(`📊 جميع السجلات المالية مع ديون:\n`);
  console.log(`عدد السجلات: ${financialRecords.length}\n`);

  if (financialRecords.length === 0) {
    console.log('ℹ️ لا توجد أي سجلات مالية تحتوي على ديون');
  } else {
    financialRecords.forEach((record, idx) => {
      console.log(`\n${idx + 1}. السجل:`);
      console.log(`   doctorId: ${record.doctorId}`);
      console.log(`   pharmacyId: ${record.pharmacyId}`);
      console.log(`   عدد الديون: ${record.debts.length}`);
      
      if (record.debts.length > 0) {
        console.log(`   الديون:`);
        record.debts.slice(0, 5).forEach((d, dIdx) => {
          console.log(`     ${dIdx + 1}. patientId: ${d.patientId}`);
          console.log(`        المبلغ: ${d.amount} ₪`);
          console.log(`        الحالة: ${d.status}`);
          console.log(`        الوصف: ${d.description}`);
          console.log(`        التاريخ: ${new Date(d.date).toLocaleDateString('ar-SA')}`);
        });
        if (record.debts.length > 5) {
          console.log(`     ... و${record.debts.length - 5} ديون أخرى`);
        }
      }
    });
  }

  // Get all transactions
  const transactionRecords = await Financial.find({ transactions: { $exists: true, $ne: [] } });
  console.log(`\n\n📊 جميع السجلات المالية مع عمليات إيراد:\n`);
  console.log(`عدد السجلات: ${transactionRecords.length}\n`);

  transactionRecords.forEach((record, idx) => {
    if (record.transactions && record.transactions.length > 0) {
      console.log(`\n${idx + 1}. السجل:`);
      console.log(`   doctorId: ${record.doctorId}`);
      console.log(`   pharmacyId: ${record.pharmacyId}`);
      console.log(`   عدد العمليات: ${record.transactions.length}`);
      
      if (record.transactions.length > 0) {
        console.log(`   أول 3 عمليات:`);
        record.transactions.slice(0, 3).forEach((t, tIdx) => {
          console.log(`     ${tIdx + 1}. patientId: ${t.patientId}`);
          console.log(`        المبلغ: ${t.amount} ₪`);
          console.log(`        الوصف: ${t.description}`);
          console.log(`        التاريخ: ${new Date(t.date).toLocaleDateString('ar-SA')}`);
        });
        if (record.transactions.length > 3) {
          console.log(`     ... و${record.transactions.length - 3} عمليات أخرى`);
        }
      }
    }
  });

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
