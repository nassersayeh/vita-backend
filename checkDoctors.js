const mongoose = require('mongoose');
require('./models/User');
const User = mongoose.model('User');

mongoose.connect('mongodb://localhost:27018/vita', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('Connected to MongoDB');
    const doctors = await User.find({ role: 'Doctor' }).select('fullName specialty city rating').limit(10);
    console.log('Doctors found:', doctors.length);
    doctors.forEach(doc => {
      console.log(`- ${doc.fullName} | ${doc.specialty || 'No specialty'} | ${doc.city} | Rating: ${doc.rating}`);
    });
    
    const dentalDoctors = await User.find({ 
      role: 'Doctor', 
      $or: [
        { specialty: /dental/i },
        { specialty: /dentist/i },
        { specialty: /أسنان/i },
        { specialty: /اسنان/i }
      ]
    });
    console.log('\nDental doctors found:', dentalDoctors.length);
    dentalDoctors.forEach(doc => {
      console.log(`- ${doc.fullName} | ${doc.specialty} | ${doc.city}`);
    });
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Database connection error:', err);
    process.exit(1);
  });