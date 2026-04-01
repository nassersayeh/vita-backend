const mongoose = require('mongoose');
const LabRequest = require('./models/LabRequest');
const Clinic = require('./models/Clinic');

const MONGO_URI = 'mongodb+srv://nassersayeh:pop1990@cluster0.vefyn0g.mongodb.net/?appName=Cluster0';

async function fix() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  // Find lab requests without clinicId
  const orphans = await LabRequest.find({
    $or: [
      { clinicId: null },
      { clinicId: { $exists: false } }
    ]
  });
  console.log('Lab requests without clinicId:', orphans.length);

  for (const req of orphans) {
    console.log('  ID:', req._id, 'requestedBy:', req.requestedBy, 'doctorId:', req.doctorId, 'approvalStatus:', req.approvalStatus);

    // Try to find clinic by staff (requestedBy) or by doctor
    let clinic = null;
    if (req.requestedBy) {
      clinic = await Clinic.findOne({ 'staff.userId': req.requestedBy });
    }
    if (!clinic && req.doctorId) {
      clinic = await Clinic.findOne({ 'doctors.doctorId': req.doctorId });
    }

    if (clinic) {
      req.clinicId = clinic._id;
      await req.save();
      console.log('    -> Fixed! Set clinicId to', clinic._id.toString(), '(' + clinic.name + ')');
    } else {
      console.log('    -> Could not find clinic');
    }
  }

  console.log('Done');
  await mongoose.disconnect();
}

fix().catch(err => {
  console.error(err);
  process.exit(1);
});
