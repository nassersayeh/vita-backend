/**
 * Script: Deep audit - show all transactions and debts with details
 */

const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected\n');

  const Clinic = require('../models/Clinic');
  const User = require('../models/User');
  const Financial = require('../models/Financial');
  const Appointment = require('../models/Appointment');

  const clinic = await Clinic.findOne({ name: /الشعب/i });
  const clinicOwnerId = clinic.ownerId;
  const doctors = clinic.doctors.filter(d => d.status === 'active');

  // Show clinic owner transactions detail
  const ownerFin = await Financial.findOne({ doctorId: clinicOwnerId });
  
  console.log('='.repeat(80));
  console.log('CLINIC OWNER TRANSACTIONS (the source of truth for payments):');
  console.log('='.repeat(80));
  
  // Group transactions by patientId
  const txByPatient = {};
  for (const tx of ownerFin.transactions || []) {
    const pid = tx.patientId?.toString() || 'unknown';
    if (!txByPatient[pid]) txByPatient[pid] = [];
    txByPatient[pid].push(tx);
  }

  for (const [patientId, txs] of Object.entries(txByPatient)) {
    const patient = patientId !== 'unknown' ? await User.findById(patientId).select('fullName') : null;
    console.log(`\n  Patient: ${patient?.fullName || patientId}`);
    
    for (const tx of txs) {
      // Find which doctor this patient's appointment belongs to
      let doctorName = '?';
      if (patientId !== 'unknown') {
        const apt = await Appointment.findOne({ patient: patientId, doctorId: { $in: doctors.map(d => d.doctorId) } }).populate('doctorId', 'fullName');
        if (apt) doctorName = apt.doctorId?.fullName || '?';
      }
      console.log(`    ₪${tx.amount} | ${tx.description} | ${tx.paymentMethod} | Doctor: ${doctorName} | ${tx.date?.toISOString().split('T')[0]}`);
    }
    const sum = txs.reduce((s, t) => s + t.amount, 0);
    console.log(`    → Subtotal: ₪${sum}`);
  }

  // Show clinic owner debts detail
  console.log('\n' + '='.repeat(80));
  console.log('CLINIC OWNER DEBTS (ALL):');
  console.log('='.repeat(80));

  for (const d of ownerFin.debts || []) {
    const patient = d.patientId ? await User.findById(d.patientId).select('fullName') : null;
    const doctor = d.doctorId ? await User.findById(d.doctorId).select('fullName') : null;
    console.log(`  [${d.status}] ₪${d.amount} (original: ₪${d.originalAmount || '?'}) | ${d.description} | Patient: ${patient?.fullName || '?'} | Doctor: ${doctor?.fullName || '?'} | ${d.date?.toISOString().split('T')[0]} | labReqId: ${d.labRequestId || 'none'}`);
  }

  // Show each doctor's transactions
  console.log('\n' + '='.repeat(80));
  console.log('DOCTOR TRANSACTIONS:');
  console.log('='.repeat(80));

  for (const doc of doctors) {
    const user = await User.findById(doc.doctorId).select('fullName');
    const docFin = await Financial.findOne({ doctorId: doc.doctorId });
    if (!docFin || !docFin.transactions?.length) continue;
    
    console.log(`\n  👨‍⚕️ ${user?.fullName}:`);
    for (const tx of docFin.transactions) {
      const patient = tx.patientId ? await User.findById(tx.patientId).select('fullName') : null;
      console.log(`    ₪${tx.amount} | ${tx.description} | ${tx.paymentMethod} | Patient: ${patient?.fullName || '?'} | ${tx.date?.toISOString().split('T')[0]}`);
    }
  }

  // Appointments detail per doctor
  console.log('\n' + '='.repeat(80));
  console.log('APPOINTMENTS PER DOCTOR (confirmed/completed):');
  console.log('='.repeat(80));

  for (const doc of doctors) {
    const user = await User.findById(doc.doctorId).select('fullName');
    const apts = await Appointment.find({
      doctorId: doc.doctorId,
      status: { $in: ['confirmed', 'completed'] }
    }).populate('patient', 'fullName').sort({ appointmentDateTime: 1 });

    if (!apts.length) continue;
    console.log(`\n  👨‍⚕️ ${user?.fullName} (${apts.length} appointments):`);
    for (const apt of apts) {
      console.log(`    ${apt.patient?.fullName || '?'} | fee:₪${(apt.doctorFee||0)+(apt.clinicFee||apt.appointmentFee||0)} (doc:${apt.doctorFee||0}+clinic:${apt.clinicFee||apt.appointmentFee||0}) | paid:₪${apt.paymentAmount||0} | debt:₪${apt.debt||0} | isPaid:${apt.isPaid} | ${apt.appointmentDateTime?.toISOString().split('T')[0]}`);
    }
  }

  await mongoose.connection.close();
  console.log('\n🔌 Done!');
}

run().catch(err => {
  console.error('❌ Error:', err);
  mongoose.connection.close();
  process.exit(1);
});
