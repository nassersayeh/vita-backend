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
  console.log('المرضى الموجودون:', existingPatients.length);
  
  // === Collect all orphaned patient IDs and try to find names ===
  const patientNames = {};
  
  // 1. From Financial debts (has patientId field)
  const allFinancials = await Financial.find({}).lean();
  for (const f of allFinancials) {
    for (const d of (f.debts || [])) {
      if (!d.patientId) continue;
      const pid = d.patientId.toString();
      if (!existingPatientIds.includes(pid)) {
        if (!patientNames[pid]) patientNames[pid] = { name: null, debts: [], transactions: [] };
        patientNames[pid].debts.push({
          amount: d.amount,
          description: d.description,
          status: d.status,
          date: d.date
        });
      }
    }
    for (const t of (f.transactions || [])) {
      if (!t.patientId) continue;
      const pid = t.patientId.toString();
      if (!existingPatientIds.includes(pid)) {
        if (!patientNames[pid]) patientNames[pid] = { name: null, debts: [], transactions: [] };
        patientNames[pid].transactions.push({
          amount: t.amount,
          description: t.description,
          date: t.date
        });
      }
    }
  }
  
  // 2. Try to populate names by looking up the User collection (even though they're deleted)
  // Since they're deleted, we need to find names elsewhere
  // Check if there are any deleted User documents somehow
  const allUsers = await User.find({}).select('_id name role').lean();
  const userMap = {};
  for (const u of allUsers) {
    userMap[u._id.toString()] = u.name;
  }
  
  // 3. From Appointments
  const allAppts = await Appointment.find({}).lean();
  const orphanedAppts = [];
  for (const a of allAppts) {
    if (!a.patient) continue;
    const pid = a.patient.toString();
    if (!existingPatientIds.includes(pid)) {
      if (!patientNames[pid]) patientNames[pid] = { name: null, debts: [], transactions: [] };
      orphanedAppts.push(a);
      // Try to get name from patient populated field or patientName
      if (a.patientName) patientNames[pid].name = a.patientName;
      if (userMap[pid]) patientNames[pid].name = userMap[pid];
    }
  }
  
  // 4. From Medical Records
  const allRecords = await MedicalRecord.find({}).lean();
  const orphanedRecords = [];
  for (const r of allRecords) {
    if (!r.patient) continue;
    const pid = r.patient.toString();
    if (!existingPatientIds.includes(pid)) {
      if (!patientNames[pid]) patientNames[pid] = { name: null, debts: [], transactions: [] };
      orphanedRecords.push(r);
    }
  }
  
  // 5. From Lab Requests  
  const allLabs = await LabRequest.find({}).lean();
  const orphanedLabs = [];
  for (const l of allLabs) {
    if (!l.patient) continue;
    const pid = l.patient.toString();
    if (!existingPatientIds.includes(pid)) {
      if (!patientNames[pid]) patientNames[pid] = { name: null, debts: [], transactions: [] };
      orphanedLabs.push(l);
      if (l.patientName) patientNames[pid].name = l.patientName;
    }
  }
  
  // 6. From doctor.patients arrays
  const doctors = await User.find({ role: 'doctor' }).select('name patients').lean();
  const orphanedDoctorRefs = [];
  for (const doc of doctors) {
    if (!doc.patients) continue;
    for (const pid of doc.patients) {
      if (!pid) continue;
      const pidStr = pid.toString();
      if (!existingPatientIds.includes(pidStr)) {
        if (!patientNames[pidStr]) patientNames[pidStr] = { name: null, debts: [], transactions: [] };
        orphanedDoctorRefs.push({ doctor: doc.name, patientId: pidStr });
      }
    }
  }

  // Try descriptions to extract names
  for (const [pid, info] of Object.entries(patientNames)) {
    if (!info.name) {
      // Try debt descriptions like "دين موعد - اسم المريض"
      for (const d of info.debts) {
        if (d.description && d.description.includes(' - ')) {
          const parts = d.description.split(' - ');
          if (parts.length > 1) {
            info.name = parts[parts.length - 1];
            break;
          }
        }
      }
    }
    if (!info.name) {
      for (const t of info.transactions) {
        if (t.description && t.description.includes(' - ')) {
          const parts = t.description.split(' - ');
          if (parts.length > 1) {
            info.name = parts[parts.length - 1];
            break;
          }
        }
      }
    }
  }
  
  // === PRINT RESULTS ===
  console.log('\n=============================================');
  console.log('=== ملخص البيانات اليتيمة لكل مريض محذوف ===');
  console.log('=============================================');
  
  for (const [pid, info] of Object.entries(patientNames)) {
    const apptCount = orphanedAppts.filter(a => a.patient.toString() === pid).length;
    const recordCount = orphanedRecords.filter(r => r.patient.toString() === pid).length;
    const labCount = orphanedLabs.filter(l => l.patient.toString() === pid).length;
    const doctorRefCount = orphanedDoctorRefs.filter(r => r.patientId === pid).length;
    
    console.log(`\n🔴 مريض: ${info.name || 'اسم غير معروف'} (ID: ${pid})`);
    console.log(`   مواعيد: ${apptCount}`);
    console.log(`   سجلات طبية: ${recordCount}`);
    console.log(`   طلبات مختبر: ${labCount}`);
    console.log(`   ديون: ${info.debts.length}`);
    if (info.debts.length > 0) {
      for (const d of info.debts) {
        console.log(`     - ₪${d.amount} | ${d.status} | ${d.description}`);
      }
    }
    console.log(`   معاملات مالية: ${info.transactions.length}`);
    if (info.transactions.length > 0) {
      for (const t of info.transactions) {
        console.log(`     - ₪${t.amount} | ${t.description}`);
      }
    }
    console.log(`   مراجع من الأطباء: ${doctorRefCount}`);
  }
  
  // IDs with no name - these might be from the demo clinic
  console.log('\n=== المرضى بدون اسم معروف - تفاصيل إضافية ===');
  for (const [pid, info] of Object.entries(patientNames)) {
    if (!info.name) {
      const appts = orphanedAppts.filter(a => a.patient.toString() === pid);
      console.log(`\n  ID: ${pid}`);
      for (const a of appts) {
        console.log(`    Appointment: date=${a.date}, status=${a.status}, fee=${a.fee}, notes="${a.notes || 'N/A'}"`);
      }
      for (const d of info.debts) {
        console.log(`    Debt: ₪${d.amount}, desc="${d.description}", status=${d.status}`);
      }
      for (const t of info.transactions) {
        console.log(`    Transaction: ₪${t.amount}, desc="${t.description}"`);
      }
    }
  }

  await mongoose.disconnect();
}

check().catch(console.error);
