const mongoose = require('mongoose');

mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.rsdkh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0').then(async () => {
  const MedicalRecord = require('./models/MedicalRecord');
  
  const records = await MedicalRecord.find({
    $or: [
      { 'selectedTeeth': { $exists: true, $ne: [] } },
      { 'specialtyFields.selectedTeeth': { $exists: true, $ne: [] } }
    ]
  }).select('patient selectedTeeth specialtyFields createdAt').sort({createdAt: 1}).lean();
  
  console.log('All dental records with patient ID:');
  records.forEach((r, i) => {
    const topTeeth = r.selectedTeeth || [];
    const specTeeth = r.specialtyFields ? r.specialtyFields.selectedTeeth || [] : [];
    const teeth = topTeeth.length > 0 ? topTeeth : specTeeth;
    console.log('\nRecord ' + (i+1) + '. Patient ID: ' + r.patient);
    teeth.forEach(t => {
      console.log('   Tooth #' + t.toothNumber + ': ' + t.condition);
    });
  });
  
  // Group by patient
  const byPatient = {};
  records.forEach(r => {
    const pid = String(r.patient);
    if (!byPatient[pid]) byPatient[pid] = [];
    const topTeeth = r.selectedTeeth || [];
    const specTeeth = r.specialtyFields ? r.specialtyFields.selectedTeeth || [] : [];
    const teeth = topTeeth.length > 0 ? topTeeth : specTeeth;
    teeth.forEach(t => {
      byPatient[pid].push({ toothNumber: t.toothNumber, condition: t.condition, date: r.createdAt });
    });
  });
  console.log('\n\nGrouped by patient:');
  Object.keys(byPatient).forEach(pid => {
    console.log('\nPatient ' + pid + ':');
    byPatient[pid].forEach(t => {
      console.log('  Tooth #' + t.toothNumber + ': ' + t.condition + ' on ' + new Date(t.date).toLocaleString());
    });
  });
  
  mongoose.disconnect();
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
