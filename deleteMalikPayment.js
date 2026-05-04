#!/usr/bin/env node

const mongoose = require('mongoose');
const Financial = require('./models/Financial');
const User = require('./models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function findAndDelete(dryRun = true) {
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
    
    console.log('📋 PAYMENTS FOR MALIK KAABI:\n');
    
    const indicesToRemove = [];
    fin.transactions.forEach((t, i) => {
      if (t.patientId && t.patientId.toString() === patient._id.toString()) {
        console.log('   [' + i + '] Amount: ' + t.amount + ' | ' + t.description);
        indicesToRemove.push(i);
      }
    });

    if (indicesToRemove.length === 0) {
      console.log('   No transactions found for this patient\n');
      return;
    }

    const totalToRemove = indicesToRemove.reduce((sum, idx) => sum + fin.transactions[idx].amount, 0);
    console.log('\n📊 SUMMARY:\n');
    console.log('   Transactions to remove: ' + indicesToRemove.length);
    console.log('   Total amount: ' + totalToRemove);
    console.log('   Current total earnings: ' + fin.totalEarnings);
    console.log('   New total earnings: ' + (fin.totalEarnings - totalToRemove) + '\n');

    if (dryRun) {
      console.log('🔒 DRY RUN - no changes made\n');
      console.log('To remove, run: node deleteMalikPayment.js --apply\n');
      return;
    }

    console.log('🔧 REMOVING PAYMENTS...\n');

    // Remove in reverse order to preserve indices
    for (let i = indicesToRemove.length - 1; i >= 0; i--) {
      const idx = indicesToRemove[i];
      const txn = fin.transactions[idx];
      console.log('   ✅ Removed: ' + txn.amount + ' (' + txn.description + ')');
      fin.transactions.splice(idx, 1);
    }

    fin.totalEarnings = fin.totalEarnings - totalToRemove;
    fin.markModified('transactions');
    await fin.save();

    console.log('\n✅ SUCCESS!');
    console.log('   Old total: ' + (fin.totalEarnings + totalToRemove));
    console.log('   New total: ' + fin.totalEarnings + '\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

const applyFlag = process.argv.includes('--apply');
console.log((applyFlag ? '⚡ DELETING' : '👀 DRY RUN') + '\n');
console.log('═'.repeat(60) + '\n');

findAndDelete(!applyFlag).then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
