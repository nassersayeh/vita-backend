const mongoose = require('mongoose');

async function check() {
  await mongoose.connect('mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net');
  
  const User = require('../models/User');
  const Financial = require('../models/Financial');
  const Appointment = require('../models/Appointment');
  
  // Search for any trace of these names in financial descriptions
  console.log('=== البحث عن "ناصر" و "احمد عدوي" في الديون والمعاملات ===\n');
  
  const allFinancials = await Financial.find({}).lean();
  
  for (const f of allFinancials) {
    for (const d of (f.debts || [])) {
      const desc = d.description || '';
      if (desc.includes('ناصر') || desc.includes('عدوي') || desc.includes('احمد') || desc.includes('nasser') || desc.includes('ahmad')) {
        console.log(`[DEBT] patientId=${d.patientId} | amount=₪${d.amount} | status=${d.status} | desc="${desc}"`);
      }
    }
    for (const t of (f.transactions || [])) {
      const desc = t.description || '';
      if (desc.includes('ناصر') || desc.includes('عدوي') || desc.includes('احمد') || desc.includes('nasser') || desc.includes('ahmad')) {
        console.log(`[TX] patientId=${t.patientId} | amount=₪${t.amount} | desc="${desc}"`);
      }
    }
  }

  // Also check appointments for any trace
  console.log('\n=== البحث في المواعيد ===');
  const allAppts = await Appointment.find({}).lean();
  for (const a of allAppts) {
    const notes = (a.notes || '').toLowerCase();
    const patientName = (a.patientName || '').toLowerCase();
    if (notes.includes('ناصر') || notes.includes('عدوي') || notes.includes('احمد') ||
        patientName.includes('ناصر') || patientName.includes('عدوي') || patientName.includes('احمد')) {
      console.log(`[APPT] patient=${a.patient} | date=${a.date} | notes="${a.notes}" | patientName="${a.patientName}"`);
    }
  }
  
  // Search in doctors' patients  
  console.log('\n=== جميع IDs الفريدة للمرضى المحذوفين في مصفوفات الأطباء ===');
  const existingPatients = await User.find({ role: 'patient' }).select('_id').lean();
  const existingIds = existingPatients.map(p => p._id.toString());
  
  const doctors = await User.find({ role: 'doctor' }).select('name patients').lean();
  const orphanedIds = new Set();
  for (const doc of doctors) {
    if (!doc.patients) continue;
    for (const pid of doc.patients) {
      if (pid && !existingIds.includes(pid.toString())) {
        orphanedIds.add(pid.toString());
      }
    }
  }
  console.log('Orphaned IDs in doctor arrays:', [...orphanedIds]);
  
  // IMPORTANT: Let's look at ALL User documents (not just patients) to see if any deleted users still exist
  console.log('\n=== جميع المستخدمين في قاعدة البيانات ===');
  const allUsers = await User.find({}).select('_id name role email mobileNumber').lean();
  for (const u of allUsers) {
    console.log(`  ${u._id} | ${u.name} | ${u.role} | ${u.email || 'N/A'} | ${u.mobileNumber || 'N/A'}`);
  }
  
  // Let's check if "ناصر السايح" or "احمد عدوي" exist as deleted users
  console.log('\n=== البحث عن ناصر السايح و احمد عدوي ===');
  const nasser = await User.findOne({ name: /ناصر/ }).lean();
  const ahmad = await User.findOne({ name: /عدوي/ }).lean();
  console.log('ناصر:', nasser ? `Found: ${nasser._id} - ${nasser.name}` : 'NOT FOUND');
  console.log('احمد عدوي:', ahmad ? `Found: ${ahmad._id} - ${ahmad.name}` : 'NOT FOUND');
  
  // Check the unique patient IDs from ALL collections
  console.log('\n=== كل IDs الفريدة للمرضى في كل الجداول ===');
  const allPatientIds = new Set();
  
  for (const a of allAppts) {
    if (a.patient) allPatientIds.add(a.patient.toString());
  }
  const MedicalRecord = require('../models/MedicalRecord');
  const allRecords = await MedicalRecord.find({}).select('patient').lean();
  for (const r of allRecords) {
    if (r.patient) allPatientIds.add(r.patient.toString());
  }
  const LabRequest = require('../models/LabRequest');
  const allLabs = await LabRequest.find({}).select('patient patientName').lean();
  for (const l of allLabs) {
    if (l.patient) allPatientIds.add(l.patient.toString());
  }
  for (const f of allFinancials) {
    for (const d of (f.debts || [])) {
      if (d.patientId) allPatientIds.add(d.patientId.toString());
    }
    for (const t of (f.transactions || [])) {
      if (t.patientId) allPatientIds.add(t.patientId.toString());
    }
  }
  
  console.log('Total unique patient IDs across all collections:', allPatientIds.size);
  console.log('Existing patient IDs:', existingIds.length);
  
  const orphaned = [...allPatientIds].filter(id => !existingIds.includes(id));
  console.log('Orphaned patient IDs:', orphaned.length);
  
  // For each orphaned ID, check if there's a User document (maybe role changed or something)
  console.log('\n=== فحص إذا أي ID يتيم يتطابق مع مستخدم موجود (أي دور) ===');
  for (const pid of orphaned) {
    const user = allUsers.find(u => u._id.toString() === pid);
    if (user) {
      console.log(`  ${pid} => EXISTS as ${user.role}: "${user.name}"`);
    } else {
      console.log(`  ${pid} => DELETED (no User document)`);
    }
  }

  await mongoose.disconnect();
}

check().catch(console.error);
