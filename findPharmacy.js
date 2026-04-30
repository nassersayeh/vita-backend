const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./models/User');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function find() {
  try {
    await mongoose.connect(MONGO_URI);
    
    const pharmacies = await User.find({ role: 'pharmacy' }).limit(3);
    console.log('Found pharmacies:', pharmacies.length);
    pharmacies.forEach(p => {
      console.log(`  - ${p.fullName} (ID: ${p._id})`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

find();
