const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net').then(async () => {
  const User = require('./models/User');
  const doctorIds = [
    '69ce3a496ae5750e29c53519',
    '69ce3a496ae5750e29c5351c',
    '69ce3a4a6ae5750e29c5351f',
    '69ce3a4a6ae5750e29c53522',
    '69ce3a4a6ae5750e29c53525',
    '69ce3a4a6ae5750e29c53528'
  ];
  
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const fullSchedule = days.map(day => ({
    day: day,
    timeSlots: [{ start: '09:00', end: '23:59' }]
  }));
  
  for (const id of doctorIds) {
    const result = await User.updateOne(
      { _id: id },
      { 
        $set: { 
          workingSchedule: fullSchedule,
          'workplaces.0.schedule': fullSchedule
        }
      }
    );
    const doc = await User.findById(id).select('fullName');
    console.log('Updated', doc.fullName, '- Modified:', result.modifiedCount);
  }
  
  console.log('\nAll doctors updated!');
  process.exit(0);
});
