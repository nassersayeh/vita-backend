// Fix existing paid appointments that are missing paidAt field
const mongoose = require('mongoose');
const Appointment = require('./models/Appointment');

const MONGO_URI = 'mongodb+srv://nassersayeh:pop1990@cluster0.vefyn0g.mongodb.net/?appName=Cluster0';

async function fix() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  // Find appointments that are isPaid=true but have no paidAt
  const appointments = await Appointment.find({
    isPaid: true,
    $or: [
      { paidAt: { $exists: false } },
      { paidAt: null }
    ]
  });

  console.log(`Found ${appointments.length} paid appointments without paidAt`);

  for (const appt of appointments) {
    // Use updatedAt as paidAt fallback
    appt.paidAt = appt.updatedAt || new Date();
    await appt.save();
    console.log(`Fixed appointment ${appt._id} - set paidAt to ${appt.paidAt}`);
  }

  console.log('Done!');
  await mongoose.disconnect();
}

fix().catch(err => {
  console.error(err);
  process.exit(1);
});
