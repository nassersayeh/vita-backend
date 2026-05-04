#!/usr/bin/env node

/**
 * Script to remove the 10 shekel payment for Malik Kaabi
 */

const mongoose = require('mongoose');
const Financial = require('./models/Financial');
const User = require('./models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function removePayment(dryRun = true) {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected\n');

    // Alshaab clinic owner ID
    const clinicOwnerId = '69ce33c830727c24d322fdeb';

    // Find Malik Kaabi patient
    console.log('🔍 Looking for Malik Kaabi patient...');
    const patient = await User.findOne({
      fullName: { $regex: 'ملك كعبي', $options: 'i' }
    });

    if (!patient) {
      console.log('❌ Could not find patient "ملك كعبي"\n');
      console.log('Searching for similar names...\n');
      const similarPatients = await User.find({
        fullName: { $regex: 'ملك|كعبي', $options: 'i' }
      }).select('_id fullName');
      
      console.log('Similar patients found:');
      similarPatients.forEach(p => {
        console.log(`  - ${p.fullName} (ID: ${p._id})`);
      });
      return;
    }

    console.log(`✅ Found patient: ${patient.fullName} (ID: ${patient._id})\n`);

    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    
    if (!financial) {
      console.log('❌ No financial record found');
      return;
    }

    console.log('📊 CURRENT STATE:\n');
    console.log(`   Total Earnings: ${financial.totalEarnings}`);
    console.log(`   Total Transactions: ${financial.transactions.length}`);

    // Find the 10 shekel transaction for this patient
    let transactionIndex = financial.transactions.findIndex(txn =>
      txn.amount === 10 &&
      txn.patientId?.toString() === patient._id.toString() &&
      (txn.description === 'دفعة من مريض' || txn.description?.includes('دفعة'))
    );

    // If not found, also check for transactions without patientId (recently restored)
    if (transactionIndex === -1) {
      const tenShekelCount = financial.transactions.filter(t => t.amount === 10).length;
      if (tenShekelCount > 0) {
        console.log(`\nℹ️  Found ${tenShekelCount} transaction(s) with 10 shekel`);
        console.log('Checking for the one without patientId (recently restored)...\n');
        
        transactionIndex = financial.transactions.findIndex(txn =>
          txn.amount === 10 &&
          !txn.patientId &&
          (txn.description === 'دفعة من مريض' || txn.description?.includes('دفعة'))
        );
      }
    }

    if (transactionIndex === -1) {
      console.log(`\n❌ Could not find 10 shekel payment for ${patient.fullName}\n`);
      
      // Show all 10 shekel transactions
      console.log('Showing all 10 shekel transactions:\n');
      financial.transactions.forEach((txn, idx) => {
        if (txn.amount === 10) {
          const patientData = txn.patientId ? `Patient ID: ${txn.patientId}` : 'Unknown patient';
          console.log(`   [${idx}] ${txn.amount} - ${patientData} - ${txn.description}`);
        }
      });
      return;
    }

    const transaction = financial.transactions[transactionIndex];
    console.log(`\n✅ Found payment to remove:`);
    console.log(`   Index: ${transactionIndex}`);
    console.log(`   Amount: ${transaction.amount}`);
    console.log(`   Patient: ${patient.fullName}`);
    console.log(`   Description: ${transaction.description}`);
    console.log(`   Date: ${new Date(transaction.date).toLocaleDateString()}\n`);

    if (dryRun) {
      console.log('🔒 DRY RUN - no changes made');
      console.log('\nTo remove payment, run: node removePayment.js --apply\n');
      console.log(`After removal:`);
      console.log(`   New Total Earnings: ${financial.totalEarnings - 10}`);
      console.log(`   New Transaction Count: ${financial.transactions.length - 1}\n`);
      return;
    }

    // Apply removal
    console.log('🔧 REMOVING PAYMENT...\n');
    
    financial.transactions.splice(transactionIndex, 1);
    financial.totalEarnings = financial.totalEarnings - 10;

    financial.markModified('transactions');
    await financial.save();

    console.log(`✅ SUCCESS!`);
    console.log(`   Removed: 10 shekel from ${patient.fullName}`);
    console.log(`   Old total: ${financial.totalEarnings + 10}`);
    console.log(`   New total: ${financial.totalEarnings}`);
    console.log(`   New transaction count: ${financial.transactions.length}\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Main
const applyFlag = process.argv.includes('--apply');
console.log(`${applyFlag ? '⚡ APPLYING REMOVAL' : '👀 DRY RUN MODE'}\n`);
console.log('═'.repeat(60) + '\n');

removePayment(!applyFlag).then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
