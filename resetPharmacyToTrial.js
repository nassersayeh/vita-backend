const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect('mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin').then(async () => {
  const User = require('./models/User');
  const user = await User.findOne({ phone: '0566000000' });
  if (!user) { console.log('User not found'); process.exit(1); }

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 7);

  user.isPaid = false;
  user.subscriptionEndDate = null;
  user.trialEndDate = trialEnd;
  user.hasAcceptedOffer = true;

  await user.save({ validateBeforeSave: false });
  console.log('✅ Reset to trial OK. trialEndDate:', trialEnd);
  process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });
