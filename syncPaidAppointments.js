const mongoose = require('mongoose');
const Appointment = require('./models/Appointment');
const Financial = require('./models/Financial');
const User = require('./models/User');

async function syncExistingPaidAppointments() {
  try {
    console.log('Starting sync of existing paid appointments...');

    // Find all paid appointments
    const paidAppointments = await Appointment.find({
      isPaid: true,
      paymentAmount: { $gt: 0 }
    }).populate('doctorId', 'fullName');

    console.log(`Found ${paidAppointments.length} paid appointments`);

    let syncedCount = 0;

    for (const appointment of paidAppointments) {
      try {
        // Check if this specific appointment payment is already recorded in financial
        const existingTransaction = await Financial.findOne({
          doctorId: appointment.doctorId._id,
          'transactions.appointmentId': appointment._id
        });

        if (!existingTransaction) {
          // Payment not recorded, add it
          let doctorFinancial = await Financial.findOne({ doctorId: appointment.doctorId._id });

          if (!doctorFinancial) {
            doctorFinancial = new Financial({ doctorId: appointment.doctorId._id });
            await doctorFinancial.save();
          }

          doctorFinancial.transactions.push({
            amount: appointment.paymentAmount,
            description: `Appointment payment - ${appointment.reason || 'Consultation'}`,
            date: appointment.paidAt || appointment.appointmentDateTime,
            patientId: appointment.patient,
            appointmentId: appointment._id,
            paymentMethod: 'Cash',
          });

          doctorFinancial.totalEarnings += appointment.paymentAmount;
          await doctorFinancial.save();

          syncedCount++;
          console.log(`Synced payment for appointment ${appointment._id}`);
        }
      } catch (error) {
        console.error(`Error syncing appointment ${appointment._id}:`, error);
      }
    }

    console.log(`Sync completed. Added ${syncedCount} payments to financial records.`);

  } catch (error) {
    console.error('Error during sync:', error);
  } finally {
    mongoose.connection.close();
  }
}

// Run the sync if this script is executed directly
if (require.main === module) {
  // Connect to MongoDB
  mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.rsdkh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }).then(() => {
    console.log('Connected to MongoDB');
    return syncExistingPaidAppointments();
  }).catch(error => {
    console.error('MongoDB connection error:', error);
  });
}

module.exports = syncExistingPaidAppointments;