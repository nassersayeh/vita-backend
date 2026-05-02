// Script: listAllClaimsByCompany.js
// Purpose: List all InsuranceClaims grouped by insuranceCompany (name) and insuranceCompanyId

const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceClaim = require('./models/InsuranceClaim');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function run() {
  try {
    await mongoose.connect('mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin');
    const claims = await InsuranceClaim.find();
    const map = {};
    claims.forEach(claim => {
      const name = claim.insuranceCompany || 'NO_NAME';
      const id = claim.insuranceCompanyId ? claim.insuranceCompanyId.toString() : 'null';
      if (!map[name]) map[name] = {};
      if (!map[name][id]) map[name][id] = 0;
      map[name][id]++;
    });
    console.log('=== Claims grouped by company name and id ===');
    Object.entries(map).forEach(([name, ids]) => {
      Object.entries(ids).forEach(([id, count]) => {
        console.log(`Name: "${name}" | ID: ${id} | Claims: ${count}`);
      });
    });
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

run();
