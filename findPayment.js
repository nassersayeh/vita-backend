#!/usr/bin/env node

/**
 * Script to find and remove a specific payment
 */

const mongoose = require('mongoose');
const Financial = require('./models/Financial');
const User = require('./models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function findAndRemove() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected\n');

    // Alshaab clinic owner ID
    const clinicOwnerId = '69ce33c830727c24d322fdeb';

    // Find Malik Kaabi patient
    const patient = await User.findOne({
      fullName: { $regex: 'ملك كعبي', $options: 'i' }
    });

    if (!patient) {
      console.log('❌ Could not find patient "ملك كعبي"\n');
      return;
    }

    console.log(`✅ Found patient: ${patient.fullName} (ID: ${patient._id})\n`);

    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    
    if (!financial) {
      console.log('❌ No financial record found');
      return;
    }

    // Find all transactions for this patient
    console.log(`📋 ALL PAYMENTS FOR ${patient.fullName}:\n`);
    const patientTransactions = [];
    
    financial.transactions.forEach((txn, idx) => {
      if (txn.patientId?.toString() === patient._id.toString()) {
        patientTransactions.push({ idx, txn });
        console.log(`   [${idx}] Amount: ${txn.amount} | Date: ${new Date(txn.date).toLocaleDateString()} | ${txn.description}`);
      }
    });

    if (patientTransactions.length === 0) {
      console.log('   No payments found for this patient\n');
      return;
    }

    console.log(`\n💡 To remove a specific payment, use:`);
    console.log(`   node removeSpecificPayment.js <index>\n`);
    console.log(`Example: node removeSpecificPayment.js 11\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

findAndRemove().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
