const mongoose = require('mongoose');
const Financial = require('./models/Financial');
const User = require('./models/User');

async function resetDoctorFinancial() {
  try {
    await mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.rsdkh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

    // Find the doctor
    const doctor = await User.findOne({ fullName: 'yaqeen yasin' });
    if (!doctor) {
      console.log('Doctor not found');
      return;
    }

    console.log('Found doctor:', doctor._id);

    // Delete existing financial record
    const result = await Financial.deleteOne({ doctorId: doctor._id });
    console.log('Deleted financial record:', result.deletedCount);

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}

resetDoctorFinancial();