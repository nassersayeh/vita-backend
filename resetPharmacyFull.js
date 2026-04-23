const mongoose = require('mongoose');

mongoose.connect('mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin').then(async () => {
  const db = mongoose.connection.db;

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 7);

  const result = await db.collection('users').updateOne(
    { fullName: 'تيست', role: 'Pharmacy' },
    {
      $set: {
        isPaid: false,
        trialEndDate: trialEnd,
        hasAcceptedOffer: false,
        trialUsed: false,
        subscriptionEndDate: null,
        dashboardRemainingTrialMs: null,
        dashboardTrialCancelledAt: null,
        savedCard: null,
        vitatAI: {
          hasAcceptedTrial: false,
          trialStartDate: null,
          trialEndDate: null,
          trialCancelledAt: null,
          remainingTrialMs: null,
          isSubscribed: false,
          subscriptionStartDate: null,
          subscriptionEndDate: null,
          subscriptionStatus: null,
          additionalTrialDaysGranted: 0,
          additionalTrialStartDate: null,
          additionalTrialEndDate: null,
        }
      }
    }
  );

  console.log('✅ Full reset done:', result.modifiedCount, 'doc(s). trialEndDate:', trialEnd);
  process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });
