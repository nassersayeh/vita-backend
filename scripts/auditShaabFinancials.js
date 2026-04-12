/**
 * Script: Audit financials for "مركز الشعب الطبي"
 * Step 1: Collect all data to understand the current state
 */

const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB\n');

  const Clinic = require('../models/Clinic');
  const User = require('../models/User');
  const Financial = require('../models/Financial');
  const Appointment = require('../models/Appointment');
  const LabRequest = require('../models/LabRequest');

  // Find clinic
  const clinic = await Clinic.findOne({ name: /الشعب/i });
  if (!clinic) { console.log('❌ Clinic not found'); process.exit(1); }
  
  console.log(`📋 Clinic: "${clinic.name}"`);
  console.log(`   Owner ID: ${clinic.ownerId}\n`);

  const owner = await User.findById(clinic.ownerId).select('fullName');
  console.log(`👤 Owner: ${owner?.fullName}\n`);

  // Get all doctors
  const doctors = clinic.doctors.filter(d => d.status === 'active');
  console.log(`👨‍⚕️ Active Doctors (${doctors.length}):`);
  for (const doc of doctors) {
    const user = await User.findById(doc.doctorId).select('fullName');
    console.log(`   - ${user?.fullName} [${doc.doctorId}] clinicPercentage: ${doc.clinicPercentage}%`);
  }

  // Get accountant
  const accountantStaff = clinic.staff.find(s => s.role === 'Accountant' && s.status === 'active');
  const accountant = await User.findById(accountantStaff?.userId).select('fullName');
  console.log(`\n💰 Accountant: ${accountant?.fullName} [${accountantStaff?.userId}]\n`);

  const clinicOwnerId = clinic.ownerId;
  const doctorIds = doctors.map(d => d.doctorId);
  const allIds = [clinicOwnerId, ...doctorIds];

  // =============== CLINIC OWNER FINANCIAL ===============
  console.log('='.repeat(80));
  console.log('📊 CLINIC OWNER FINANCIAL');
  console.log('='.repeat(80));
  
  const ownerFin = await Financial.findOne({ doctorId: clinicOwnerId });
  if (ownerFin) {
    console.log(`   totalEarnings: ${ownerFin.totalEarnings}`);
    console.log(`   totalExpenses: ${ownerFin.totalExpenses}`);
    console.log(`   Transactions: ${ownerFin.transactions?.length || 0}`);
    console.log(`   Debts: ${ownerFin.debts?.length || 0}`);
    console.log(`   Expenses: ${ownerFin.expenses?.length || 0}`);
    
    // Debts breakdown
    const pendingDebts = (ownerFin.debts || []).filter(d => d.status === 'pending');
    const paidDebts = (ownerFin.debts || []).filter(d => d.status === 'paid');
    const totalPendingDebt = pendingDebts.reduce((s, d) => s + d.amount, 0);
    const totalPaidDebtOriginal = paidDebts.reduce((s, d) => s + (d.originalAmount || d.amount), 0);
    console.log(`\n   Pending debts: ${pendingDebts.length} (total: ₪${totalPendingDebt})`);
    console.log(`   Paid debts: ${paidDebts.length} (original total: ₪${totalPaidDebtOriginal})`);
    
    // Transactions sum
    const txSum = (ownerFin.transactions || []).reduce((s, t) => s + t.amount, 0);
    console.log(`\n   Transactions sum: ₪${txSum}`);

    // Show debts by doctor
    console.log('\n   📋 Debts by doctor:');
    const debtsByDoctor = {};
    for (const d of ownerFin.debts || []) {
      const docId = d.doctorId?.toString() || 'no-doctor';
      if (!debtsByDoctor[docId]) debtsByDoctor[docId] = { pending: 0, paid: 0, pendingCount: 0, paidCount: 0 };
      if (d.status === 'pending') {
        debtsByDoctor[docId].pending += d.amount;
        debtsByDoctor[docId].pendingCount++;
      } else {
        debtsByDoctor[docId].paid += (d.originalAmount || d.amount);
        debtsByDoctor[docId].paidCount++;
      }
    }
    for (const [docId, info] of Object.entries(debtsByDoctor)) {
      const docUser = docId !== 'no-doctor' ? await User.findById(docId).select('fullName') : null;
      const name = docUser?.fullName || docId;
      console.log(`      ${name}: pending(${info.pendingCount})=₪${info.pending.toFixed(2)}, paid(${info.paidCount})=₪${info.paid.toFixed(2)}`);
    }
  } else {
    console.log('   ❌ No financial record for clinic owner');
  }

  // =============== EACH DOCTOR'S FINANCIAL ===============
  console.log('\n' + '='.repeat(80));
  console.log('📊 DOCTOR FINANCIALS');
  console.log('='.repeat(80));

  for (const doc of doctors) {
    const user = await User.findById(doc.doctorId).select('fullName');
    const docFin = await Financial.findOne({ doctorId: doc.doctorId });
    console.log(`\n   👨‍⚕️ ${user?.fullName} (clinic takes ${doc.clinicPercentage}%)`);
    
    if (docFin) {
      console.log(`      totalEarnings: ₪${docFin.totalEarnings}`);
      console.log(`      totalExpenses: ₪${docFin.totalExpenses}`);
      console.log(`      Transactions: ${docFin.transactions?.length || 0}`);
      console.log(`      Debts: ${docFin.debts?.length || 0}`);
      
      const txSum = (docFin.transactions || []).reduce((s, t) => s + t.amount, 0);
      console.log(`      Transactions sum: ₪${txSum}`);
      
      const pendingDebts = (docFin.debts || []).filter(d => d.status === 'pending');
      const totalPending = pendingDebts.reduce((s, d) => s + d.amount, 0);
      console.log(`      Pending debts: ${pendingDebts.length} = ₪${totalPending}`);
    } else {
      console.log(`      ❌ No financial record`);
    }
  }

  // =============== APPOINTMENTS ANALYSIS ===============
  console.log('\n' + '='.repeat(80));
  console.log('📊 APPOINTMENTS ANALYSIS');
  console.log('='.repeat(80));

  for (const doc of doctors) {
    const user = await User.findById(doc.doctorId).select('fullName');
    
    const allApts = await Appointment.find({
      doctorId: doc.doctorId,
      status: { $in: ['confirmed', 'completed'] }
    });

    const totalFees = allApts.reduce((s, a) => s + (a.doctorFee || 0) + (a.clinicFee || a.appointmentFee || 0), 0);
    const totalPaid = allApts.reduce((s, a) => s + (a.paymentAmount || 0), 0);
    const totalDebt = allApts.reduce((s, a) => s + (a.debt || 0), 0);
    const paidCount = allApts.filter(a => a.isPaid).length;
    const unpaidCount = allApts.filter(a => !a.isPaid).length;

    console.log(`\n   👨‍⚕️ ${user?.fullName}:`);
    console.log(`      Total appointments: ${allApts.length} (paid: ${paidCount}, unpaid: ${unpaidCount})`);
    console.log(`      Total fees: ₪${totalFees.toFixed(2)}`);
    console.log(`      Total paid: ₪${totalPaid.toFixed(2)}`);
    console.log(`      Total debt (from appointments): ₪${totalDebt.toFixed(2)}`);
    console.log(`      Expected total: ₪${(totalPaid + totalDebt).toFixed(2)}`);
  }

  // =============== LAB REQUESTS ===============
  console.log('\n' + '='.repeat(80));
  console.log('📊 LAB REQUESTS');
  console.log('='.repeat(80));

  const labReqs = await LabRequest.find({
    $or: [
      { clinicId: clinic._id },
      { doctorId: { $in: doctorIds } }
    ],
    status: 'completed'
  }).populate('patientId', 'fullName').populate('doctorId', 'fullName');

  let labTotalCost = 0;
  let labPaidTotal = 0;
  for (const lr of labReqs) {
    labTotalCost += lr.totalCost || 0;
    labPaidTotal += lr.paidAmount || 0;
    console.log(`   ${lr.patientId?.fullName || '?'} - Dr.${lr.doctorId?.fullName || '?'} - cost:₪${lr.totalCost} paid:₪${lr.paidAmount || 0} isPaid:${lr.isPaid}`);
  }
  console.log(`\n   Lab total cost: ₪${labTotalCost}`);
  console.log(`   Lab total paid: ₪${labPaidTotal}`);
  console.log(`   Lab unpaid: ₪${labTotalCost - labPaidTotal}`);

  // =============== WHAT SHOULD BE CORRECT ===============
  console.log('\n' + '='.repeat(80));
  console.log('🎯 EXPECTED CORRECT VALUES (based on appointments + lab requests)');
  console.log('='.repeat(80));

  for (const doc of doctors) {
    const user = await User.findById(doc.doctorId).select('fullName');
    const clinicPct = doc.clinicPercentage || 0;
    const doctorPct = 100 - clinicPct;

    // Doctor's appointments
    const apts = await Appointment.find({
      doctorId: doc.doctorId,
      status: { $in: ['confirmed', 'completed'] }
    });

    let totalPayments = 0;
    let totalDebtFromApts = 0;

    for (const apt of apts) {
      totalPayments += apt.paymentAmount || 0;
      if (!apt.isPaid) {
        const fee = (apt.doctorFee || 0) + (apt.clinicFee || apt.appointmentFee || 0);
        const paid = apt.paymentAmount || 0;
        totalDebtFromApts += Math.max(0, fee - paid);
      }
    }

    // Lab requests for this doctor
    const docLabReqs = labReqs.filter(lr => lr.doctorId?._id?.toString() === doc.doctorId.toString());
    let labDebt = 0;
    let labPaid = 0;
    for (const lr of docLabReqs) {
      if (!lr.isPaid) {
        labDebt += (lr.totalCost || 0) - (lr.paidAmount || 0);
      }
      labPaid += lr.paidAmount || 0;
    }

    const doctorSharePayments = totalPayments * doctorPct / 100;
    const clinicSharePayments = totalPayments * clinicPct / 100;

    console.log(`\n   👨‍⚕️ ${user?.fullName} (doctor ${doctorPct}% / clinic ${clinicPct}%):`);
    console.log(`      Appointment payments received: ₪${totalPayments.toFixed(2)}`);
    console.log(`      → Doctor share: ₪${doctorSharePayments.toFixed(2)}`);
    console.log(`      → Clinic share: ₪${clinicSharePayments.toFixed(2)}`);
    console.log(`      Appointment debts remaining: ₪${totalDebtFromApts.toFixed(2)}`);
    console.log(`      Lab debts remaining: ₪${labDebt.toFixed(2)}`);
    console.log(`      Lab paid: ₪${labPaid.toFixed(2)}`);
    console.log(`      Doctor Financial.totalEarnings SHOULD be: ₪${doctorSharePayments.toFixed(2)}`);
  }

  // Owner's expected totalEarnings
  if (ownerFin) {
    let ownerExpectedEarnings = 0;
    for (const doc of doctors) {
      const clinicPct = doc.clinicPercentage || 0;
      const apts = await Appointment.find({
        doctorId: doc.doctorId,
        status: { $in: ['confirmed', 'completed'] }
      });
      const totalPayments = apts.reduce((s, a) => s + (a.paymentAmount || 0), 0);
      ownerExpectedEarnings += totalPayments * clinicPct / 100;
    }
    // Add lab payments
    ownerExpectedEarnings += labPaidTotal;

    // Add direct payments from clinic owner transactions (non-split)
    const ownerTxSum = (ownerFin.transactions || []).reduce((s, t) => s + t.amount, 0);
    
    console.log(`\n   🏥 Clinic Owner expected totalEarnings from splits: ₪${ownerExpectedEarnings.toFixed(2)}`);
    console.log(`   🏥 Clinic Owner current totalEarnings: ₪${ownerFin.totalEarnings}`);
    console.log(`   🏥 Clinic Owner transactions sum: ₪${ownerTxSum}`);
  }

  await mongoose.connection.close();
  console.log('\n🔌 Done!');
}

run().catch(err => {
  console.error('❌ Error:', err);
  mongoose.connection.close();
  process.exit(1);
});
