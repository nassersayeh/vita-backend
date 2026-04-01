const mongoose = require('mongoose');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const Financial = require('../models/Financial');

async function main() {
  await mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.rsdkh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');
  const doctorId = '69403da3ce3a27e7e52bacd0';
  const doctor = await User.findById(doctorId).populate('patients').lean();
  if (!doctor) { console.log('Doctor not found'); process.exit(1); }
  console.log('Found doctor, patients:', doctor.patients.length);
  const patientIds = doctor.patients.map(p => p._id);

  const appointmentDebts = await Appointment.aggregate([
    { $match: { doctorId: doctor._id, patient: { $in: patientIds }, debt: { $gt: 0 } } },
    { $group: { _id: '$patient', totalAppointmentDebt: { $sum: '$debt' } } }
  ]);

  const financialDebts = await Financial.aggregate([
    { $match: { doctorId: doctor._id } },
    { $unwind: '$debts' },
    { $match: { 'debts.patientId': { $in: patientIds }, 'debts.status': { $ne: 'paid' } } },
    { $group: { _id: '$debts.patientId', totalFinancialDebt: { $sum: '$debts.amount' } } }
  ]);

  console.log('Appointment Debts:', appointmentDebts);
  console.log('Financial Debts:', financialDebts);

  const debtMap = {};
  appointmentDebts.forEach(d => { debtMap[d._id.toString()] = (debtMap[d._id.toString()] || 0) + d.totalAppointmentDebt; });
  financialDebts.forEach(d => { debtMap[d._1?.toString?.() || d._id.toString()] = (debtMap[d._id.toString()] || 0) + d.totalFinancialDebt; });

  console.log('DebtMap:', debtMap);

  // show per patient
  doctor.patients.forEach(p => {
    const id = p._id.toString();
    console.log(p.fullName, '=> totalDebt:', debtMap[id] || 0);
  });

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });