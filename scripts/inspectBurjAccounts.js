require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const rows = await User.find({ role: 'Radiology', $or: [{ fullName: /البرج/i }, { fullName: /burj/i }] })
    .select('fullName mobileNumber address city country activationStatus').lean();
  console.log(JSON.stringify(rows, null, 2));
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
