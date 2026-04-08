const mongoose = require('mongoose');

async function check() {
  await mongoose.connect('mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net');
  
  const User = require('../models/User');
  const Financial = require('../models/Financial');
  const Appointment = require('../models/Appointment');
  const MedicalRecord = require('../models/MedicalRecord');
  const LabRequest = require('../models/LabRequest');
  
  const existingPatients = await User.find({ role: 'patient' }).select('_id name');
  const existingPatientIds = existingPatients.map(p => p._id.toString());
  
  // Get all financials with populated patient info in debts/transactions
  const allFinancials = await Financial.find({})
    .populate('debts.patient', 'name')
    .populate('transactions.patient', 'name')
    .lean();
  
  console.log('=== الديون اليتيمة مع التفاصيل ===');
  const patientNames = {};
  
  for (const f of allFinancials) {
    for (const d of f.debts) {
      if (!d.patient) continue;
      const pid = d.patient._id ? d.patient._id.toString() : d.patient.toString();
      if (!existingPatientIds.includes(pid)) {
        const name = d.patient.name || d.description || 'غير معروف';
        if (!patientNames[pid]) patientNames[pid] = name;
        if (name !== 'غير معروف') patientNames[pid] = name;
        console.log(`  Debt: Patient=${pid} | Name=${name} | Amount=₪${d.amount} | Status=${d.status} | Desc=${d.description || 'N/A'}`);
      }
    }
    for (const t of f.transactions) {
      if (!t.patient) continue;
      const pid = t.patient._id ? t.patient._id.toString() : t.patient.toString();
      if (!existingPatientIds.includes(pid)) {
        const name = t.patient.name || t.description || 'غير معروف';
        if (!patientNames[pid]) patientNames[pid] = name;
        if (name !== 'غير معروف') patientNames[pid] = name;
        console.log(`  Transaction: Patient=${pid} | Name=${name} | Amount=₪${t.amount} | Type=${t.type} | Desc=${t.description || 'N/A'}`);
      }
    }
  }
  
  console.log('\n=== أسماء المرضى المحذوفين (من الديون/المعاملات) ===');
  for (const [id, name] of Object.entries(patientNames)) {
    console.log(`  ${id} => ${name}`);
  }
  
  // Now get ALL orphaned patient IDs from all collections
  const allAppts = await Appointment.find({}).select('patient').lean();
  const allRecords = await MedicalRecord.find({}).select('patient').lean();
  const allLabs = await LabRequest.find({}).select('patient').lean();
  
  const allOrphanedIds = new Set();
  
  for (const a of allAppts) {
    if (a.patient && !existingPatientIds.includes(a.patient.toString())) {
      allOrphanedIds.add(a.patient.toString());
    }
  }
  for (const r of allRecords) {
    if (r.patient && !existingPatientIds.includes(r.patient.toString())) {
      allOrphanedIds.add(r.patient.toString());
    }
  }
  for (const l of allLabs) {
    if (l.patient && !existingPatientIds.includes(l.patient.toString())) {
      allOrphanedIds.add(l.patient.toString());
    }
  }
  for (const id of Object.keys(patientNames)) {
    allOrphanedIds.add(id);
  }
  
  // Check doctors' patients arrays
  const doctors = await User.find({ role: 'doctor' }).select('patients').lean();
  for (const doc of doctors) {
    if (doc.patients) {
      for (const pid of doc.patients) {
        if (pid && !existingPatientIds.includes(pid.toString())) {
          allOrphanedIds.add(pid.toString());
        }
      }
    }
  }

  console.log('\n=== كل IDs المرضى المحذوفين ===');
  console.log('Total unique orphaned patient IDs:', allOrphanedIds.size);
  for (const id of allOrphanedIds) {
    console.log(`  ${id} => ${patientNames[id] || '(اسم غير موجود بالسجلات المالية)'}`);
  }
  
  // Try to find names by searching description fields
  console.log('\n=== البحث في وصف الديون عن أسماء ===');
  for (const f of allFinancials) {
    for (const d of f.debts) {
      if (!d.patient) continue;
      const pid = d.patient._id ? d.patient._id.toString() : d.patient.toString();
      if (allOrphanedIds.has(pid) && d.description) {
        console.log(`  Patient ${pid}: "${d.description}" (₪${d.amount})`);
      }
    }
  }

  await mongoose.disconnect();
}

check().catch(console.error);
