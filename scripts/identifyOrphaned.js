const mongoose = require('mongoose');

async function check() {
  await mongoose.connect('mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net');
  
  const User = require('../models/User');
  const Appointment = require('../models/Appointment');
  const MedicalRecord = require('../models/MedicalRecord');
  const LabRequest = require('../models/LabRequest');
  const Financial = require('../models/Financial');
  
  // Get all existing patient IDs
  const existingPatients = await User.find({ role: 'patient' }).select('_id name');
  const existingPatientIds = existingPatients.map(p => p._id.toString());
  console.log('=== المرضى الموجودون حالياً ===');
  existingPatients.forEach(p => console.log(p._id, '-', p.name));
  console.log('Total existing patients:', existingPatients.length);
  
  // Find orphaned appointments
  const allAppointments = await Appointment.find({}).lean();
  const orphanedAppts = allAppointments.filter(a => a.patient && !existingPatientIds.includes(a.patient.toString()));
  
  console.log('\n=== المواعيد اليتيمة (لمرضى محذوفين) ===');
  const patientMap = {};
  for (const a of orphanedAppts) {
    const key = a.patient.toString();
    if (!patientMap[key]) {
      patientMap[key] = { name: a.patientName || 'غير معروف', count: 0, id: key };
    }
    if (a.patientName) patientMap[key].name = a.patientName;
    // Also try to get name from notes or other fields
    if (patientMap[key].name === 'غير معروف' && a.notes) {
      patientMap[key].name = 'من الملاحظات: ' + a.notes.substring(0, 30);
    }
    patientMap[key].count++;
  }
  
  // Try to get names from medical records too
  const allRecordsForNames = await MedicalRecord.find({ 
    patient: { $in: Object.keys(patientMap).map(id => new mongoose.Types.ObjectId(id)) }
  }).select('patient patientName').lean();
  for (const r of allRecordsForNames) {
    if (r.patientName && patientMap[r.patient.toString()]) {
      patientMap[r.patient.toString()].name = r.patientName;
    }
  }
  for (const [id, info] of Object.entries(patientMap)) {
    console.log('Patient ID:', id, '| Name:', info.name, '| Appointments:', info.count);
  }

  // Print appointment details to help identify
  console.log('\n=== تفاصيل المواعيد اليتيمة ===');
  for (const a of orphanedAppts) {
    console.log(`  ID: ${a._id} | Patient: ${a.patient} | Name: ${a.patientName || 'N/A'} | Date: ${a.date || a.createdAt} | Fee: ${a.fee || 0} | Debt: ${a.debt || 0} | Status: ${a.status}`);
  }
  
  // Check medical records
  const allRecords = await MedicalRecord.find({}).select('patient patientName').lean();
  const orphanedRecords = allRecords.filter(r => r.patient && !existingPatientIds.includes(r.patient.toString()));
  const recordMap = {};
  for (const r of orphanedRecords) {
    const key = r.patient.toString();
    if (!recordMap[key]) recordMap[key] = 0;
    recordMap[key]++;
    // update patientMap name from medical records
    if (r.patientName && patientMap[key] && patientMap[key].name === 'غير معروف') {
      patientMap[key].name = r.patientName;
    }
    if (r.patientName && !patientMap[key]) {
      patientMap[key] = { name: r.patientName, count: 0, id: key };
    }
  }
  
  // Check financial debts & transactions
  const allFinancials = await Financial.find({}).select('debts transactions clinic');
  const debtPatients = {};
  const txPatients = {};
  for (const f of allFinancials) {
    for (const d of f.debts) {
      if (d.patient && !existingPatientIds.includes(d.patient.toString())) {
        const key = d.patient.toString();
        if (!debtPatients[key]) debtPatients[key] = { count: 0, total: 0 };
        debtPatients[key].count++;
        debtPatients[key].total += d.amount || 0;
      }
    }
    for (const t of f.transactions) {
      if (t.patient && !existingPatientIds.includes(t.patient.toString())) {
        const key = t.patient.toString();
        if (!txPatients[key]) txPatients[key] = { count: 0, total: 0 };
        txPatients[key].count++;
        txPatients[key].total += t.amount || 0;
      }
    }
  }
  
  // Check lab requests
  const allLabs = await LabRequest.find({}).select('patient patientName');
  const orphanedLabs = allLabs.filter(l => l.patient && !existingPatientIds.includes(l.patient.toString()));
  const labMap = {};
  for (const l of orphanedLabs) {
    const key = l.patient.toString();
    if (!labMap[key]) labMap[key] = { name: l.patientName || 'غير معروف', count: 0 };
    labMap[key].name = l.patientName || labMap[key].name;
    labMap[key].count++;
  }
  
  // Summary by patient
  console.log('\n========================================');
  console.log('=== ملخص البيانات اليتيمة لكل مريض ===');
  console.log('========================================');
  const allOrphanIds = new Set([
    ...Object.keys(patientMap),
    ...Object.keys(recordMap),
    ...Object.keys(debtPatients),
    ...Object.keys(txPatients),
    ...Object.keys(labMap)
  ]);
  for (const id of allOrphanIds) {
    const name = patientMap[id]?.name || labMap[id]?.name || 'غير معروف';
    console.log('\n🔴 Patient:', name, '(ID:', id + ')');
    console.log('   Appointments:', patientMap[id]?.count || 0);
    console.log('   Medical Records:', recordMap[id] || 0);
    console.log('   Lab Requests:', labMap[id]?.count || 0);
    console.log('   Financial Debts:', debtPatients[id]?.count || 0, debtPatients[id] ? `(Total: ₪${debtPatients[id].total})` : '');
    console.log('   Financial Transactions:', txPatients[id]?.count || 0, txPatients[id] ? `(Total: ₪${txPatients[id].total})` : '');
  }
  
  // Also check doctor->patient references
  const Doctor = require('../models/User');
  const doctors = await Doctor.find({ role: 'doctor' }).select('name patients');
  console.log('\n=== مراجع الأطباء للمرضى المحذوفين ===');
  for (const doc of doctors) {
    if (!doc.patients || doc.patients.length === 0) continue;
    const orphanedPatientRefs = doc.patients.filter(pid => pid && !existingPatientIds.includes(pid.toString()));
    if (orphanedPatientRefs.length > 0) {
      console.log(`Doctor: ${doc.name} | Orphaned patient refs: ${orphanedPatientRefs.length}`);
      for (const pid of orphanedPatientRefs) {
        const name = patientMap[pid.toString()]?.name || labMap[pid.toString()]?.name || 'غير معروف';
        console.log(`   - ${pid} (${name})`);
      }
    }
  }
  
  await mongoose.disconnect();
}

check().catch(console.error);
