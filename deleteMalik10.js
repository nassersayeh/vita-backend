#!/usr/bin/env node

const mongoose = require('mongoose');
const Financial = require('./models/Financial');
const User = require('./models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function deleteSpecificPayment(dryRun = true) {
  try {
    await mongoose.connect(MONGODB_URI);

    const patient = await User.findOne({
      fullName: { $regex: 'ملك كعبي', $options: 'i' }
    });

    if (!patient) {
      console.log('❌ Patient not found\n');
      return;
    }

    console.log('✅ Found: ' + patient.fullName + ' (ID: ' + patient._id + ')\n');

    const fin = await Financial.findOne({ doctorId: '69ce33c830727c24d322fdeb' });
    
    console.log('📋 SEARCHING FOR 10 SHEKEL PAYMENT:\n');
    
    // Find 10 shekel payment for this patient
    let indexToRemove = -1;
    fin.transactions.forEach((t, i) => {
      if (t.amount === 10 && t.patientId && t.patientId.toString() === patient._id.toString()) {
        console.log('   [' + i + '] Amount: ' + t.amount + ' | ' + t.description);
        indexToRemove = i;
      }
    });

    if (indexToRemove === -1) {
      console.log('   ❌ No 10 shekel payment found for this patient\n');
      console.log('📋 ALL PAYMENTS FOR THIS PATIENT:\n');
      fin.transactions.forEach((t, i) => {
        if (t.patientId && t.patientId.toString() === patient._id.toString()) {
          console.log('   [' + i + '] Amount: ' + t.amount + ' | ' + t.description);
        }
      });
      return;
    }

    const txn = fin.transactions[indexToRemove];
    console.log('\n📊 SUMMARY:\n');
    console.log('   Amount: ' + txn.amount);
    console.log('   Current total earnings: ' + fin.totalEarnings);
    console.log('   New total earnings: ' + (fin.totalEarnings - 10) + '\n');

    if (dryRun) {
      console.log('🔒 DRY RUN - no changes made\n');
      console.log('To remove, run: node deleteMalik10.js --apply\n');
      return;
    }

    console.log('🔧 REMOVING PAYMENT...\n');

    console.log('   ✅ Removed: ' + txn.amount + ' (' + txn.description + ')');
    fin.transactions.splice(indexToRemove, 1);

    fin.totalEarnings = fin.totalEarnings - 10;
    fin.markModified('transactions');
    await fin.save();

    console.log('\n✅ SUCCESS!');
    console.log('   Old total: ' + (fin.totalEarnings + 10));
    console.log('   New total: ' + fin.totalEarnings + '\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

const applyFlag = process.argv.includes('--apply');
console.log((applyFlag ? '⚡ DELETING 10 SHEKEL' : '👀 DRY RUN') + '\n');
console.log('═'.repeat(60) + '\n');

deleteSpecificPayment(!applyFlag).then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
