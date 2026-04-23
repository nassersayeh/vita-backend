const mongoose = require('mongoose');
const User = require('./models/User');

mongoose.connect('mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin').then(async () => {
  const user = await User.findOne({ mobileNumber: '0566000000' });
  if (!user) { console.log('❌ Not found'); process.exit(1); }
  
  user.vitatAI = { hasAcceptedTrial: false, trialStartDate: null, trialEndDate: null, isSubscribed: false };
  user.trialUsed = false;
  user.hasAcceptedOffer = false;
  user.trialEndDate = null;
  user.isPaid = false;
  
  await user.save({ validateBeforeSave: false });
  console.log('✅ Reset done for:', user.fullName);
  mongoose.disconnect();
}).catch(err => { console.error(err); process.exit(1); });
