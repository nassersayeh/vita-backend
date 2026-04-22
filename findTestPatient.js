const mongoose = require('mongoose');
const User = require('./models/User');

async function findTestPatient() {
  try {
    await mongoose.connect('mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin');
    
    // Search for nassersayeh patient
    const patient = await User.findOne({ 
      fullName: 'nassersayeh',
      role: 'User'
    });
    
    if (patient) {
      console.log('✅ Patient found:');
      console.log('Name:', patient.fullName);
      console.log('Mobile:', patient.mobileNumber);
      console.log('ID:', patient._id);
      console.log('Full data:', {
        fullName: patient.fullName,
        mobileNumber: patient.mobileNumber,
        _id: patient._id,
        role: patient.role
      });
    } else {
      console.log('❌ Patient not found with name "nassersayeh"');
      
      // Try to find any patient
      console.log('\nSearching all patients...');
      const allPatients = await User.find({ role: 'User' }).limit(5).select('fullName mobileNumber _id');
      console.log('Found patients:', allPatients.map(p => ({
        name: p.fullName,
        mobile: p.mobileNumber,
        id: p._id
      })));
    }
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

findTestPatient();
