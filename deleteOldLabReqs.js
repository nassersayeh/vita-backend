const mongoose = require('mongoose');
const MONGODB_URI = 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

mongoose.connect(MONGODB_URI).then(async () => {
  const LabRequest = require('./models/LabRequest');

  const patientId = '69ce7f6d49893bf019b5cc2a';
  const oldClinicId = '69ce33c830727c24d322fdee';

  const result = await LabRequest.deleteMany({ patientId: patientId, clinicId: oldClinicId });
  console.log('Deleted requests from مركز الشعب:', result.deletedCount);

  // Also check for any without clinicId but with old labId
  const oldLabIds = ['69ce3a496ae5750e29c5350d', '69ce3a496ae5750e29c53510'];
  const result2 = await LabRequest.deleteMany({ patientId: patientId, labId: { $in: oldLabIds } });
  console.log('Deleted by old labId:', result2.deletedCount);

  // Show remaining
  const remaining = await LabRequest.find({ patientId: patientId }).select('_id clinicId labId status');
  console.log('Remaining requests for Nasser:', remaining.length);
  remaining.forEach(function(r) {
    console.log('  ', r._id.toString(), 'clinic:', r.clinicId, 'lab:', r.labId, 'status:', r.status);
  });

  await mongoose.disconnect();
  process.exit(0);
}).catch(function(err) {
  console.error(err);
  process.exit(1);
});
