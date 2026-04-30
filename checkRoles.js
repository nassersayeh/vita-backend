const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./models/User');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function check() {
  try {
    await mongoose.connect(MONGO_URI);
    
    const users = await User.find().select('fullName role').limit(5);
    console.log('Sample users:');
    users.forEach(u => {
      console.log(`  - ${u.fullName} (role: ${u.role})`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

check();
