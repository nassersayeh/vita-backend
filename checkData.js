const mongoose = require('mongoose');
const Appointment = require('./models/Appointment');
const Financial = require('./models/Financial');
const User = require('./models/User');

async function checkData() {
  try {
    await mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.rsdkh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

    console.log('=== ALL APPOINTMENTS WITH PAYMENT AMOUNTS ===');
    const appointments = await Appointment.find({ paymentAmount: { $gt: 0 } }).populate('doctorId', 'fullName');

    let totalAll = 0;
    let totalPaid = 0;
    let totalUnpaid = 0;

    appointments.forEach(apt => {
      const amount = apt.paymentAmount || 0;
      totalAll += amount;
      
      if (apt.isPaid) {
        totalPaid += amount;
        console.log(`PAID: Appointment ${apt._id}: ${amount} NIS, Doctor: ${apt.doctorId?.fullName || 'Unknown'}, Patient: ${apt.patient}, Reason: ${apt.reason || 'N/A'}`);
      } else {
        totalUnpaid += amount;
        console.log(`UNPAID: Appointment ${apt._id}: ${amount} NIS, Doctor: ${apt.doctorId?.fullName || 'Unknown'}, Patient: ${apt.patient}, Reason: ${apt.reason || 'N/A'}`);
      }
    });    console.log(`\nTotal from ALL appointments: ${totalAll} NIS`);
    console.log(`Total from PAID appointments: ${totalPaid} NIS`);
    console.log(`Total from UNPAID appointments: ${totalUnpaid} NIS`);

    console.log('\n=== FINANCIAL RECORDS ===');
    const financials = await Financial.find({}).populate('doctorId', 'fullName');
    let totalFinancial = 0;
    financials.forEach(fin => {
      const doctorName = fin.doctorId?.fullName || 'Unknown';
      console.log(`Financial ${fin._id}: ${fin.totalEarnings} NIS total earnings, Doctor: ${doctorName}, Transactions: ${fin.transactions.length}`);
      totalFinancial += fin.totalEarnings;
    });
    console.log(`Total from ALL Financial records: ${totalFinancial} NIS`);
    
    // Find the specific doctor's financial record
    const doctorFinancial = financials.find(f => f.doctorId?.fullName === 'yaqeen yasin');
    if (doctorFinancial) {
      console.log(`\nDoctor 'yaqeen yasin' financial record: ${doctorFinancial.totalEarnings} NIS`);
      console.log('Transactions:');
      doctorFinancial.transactions.forEach((t, i) => {
        console.log(`  ${i+1}. ${t.amount} NIS - ${t.description} (${t.date})`);
      });
    } else {
      console.log(`\nNo financial record found for doctor 'yaqeen yasin'`);
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkData();