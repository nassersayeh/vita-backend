const mongoose = require('mongoose');

mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.rsdkh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0').then(async () => {
  const User = require('./models/User');
  
  const doctor = await User.findById('69403da3ce3a27e7e52bacd0');
  console.log('Doctor workplaces details:');
  doctor.workplaces.forEach(w => {
    console.log('\nWorkplace:', w.name);
    console.log('  Active:', w.isActive);
    console.log('  Has schedule:', !!w.schedule, 'Length:', w.schedule?.length || 0);
    if (w.schedule && w.schedule.length > 0) {
      w.schedule.forEach(s => console.log('    -', s.day, ':', s.timeSlots?.length || 0, 'time slots'));
    }
  });
  
  mongoose.disconnect();
});
