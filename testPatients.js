const mongoose = require('mongoose');
const User = require('./models/User');

async function testPatientAPI() {
  try {
    await mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.rsdkh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

    // Find a doctor to test with
    const doctor = await User.findOne({ fullName: 'yaqeen yasin' });
    if (!doctor) {
      console.log('Doctor not found');
      return;
    }

    console.log('Testing patient API for doctor:', doctor._id);

    // Simulate the API call - get patients for this doctor
    const patients = await User.find({
      role: 'patient',
      'connectedDoctors.doctorId': doctor._id
    }).select('fullName mobileNumber');

    console.log('Found patients:', patients.length);
    patients.forEach(p => console.log(' -', p.fullName, p.mobileNumber));

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}

testPatientAPI();