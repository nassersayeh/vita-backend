#!/usr/bin/env node

/**
 * Script to restore the accidentally deleted transactions
 */

const mongoose = require('mongoose');
const Financial = require('./models/Financial');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

// Transactions that were deleted
const deletedTransactions = [
  { amount: 5, description: 'دفعة مريض' },
  { amount: 100, description: 'دفعة مريض' },
  { amount: 50, description: 'دفعة مريض' },
  { amount: 15, description: 'دفعة مريض' },
  { amount: 25, description: 'دفعة مريض' },
  { amount: 15, description: 'دفعة مريض' },
  { amount: 25, description: 'دفعة مريض' },
  { amount: 35, description: 'دفعة مريض' },
  { amount: 50, description: 'دفعة مريض' },
  { amount: 20, description: 'دفعة مريض' },
  { amount: 15, description: 'دفعة مريض' },
  { amount: 25, description: 'دفعة مريض' },
  { amount: 25, description: 'دفعة مريض' },
  { amount: 20, description: 'دفعة مريض' },
  { amount: 35, description: 'دفعة مريض' }
];

async function restoreTransactions(dryRun = true) {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected\n');

    // Alshaab clinic owner ID
    const clinicOwnerId = '69ce33c830727c24d322fdeb';

    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    
    if (!financial) {
      console.log('❌ No financial record found');
      return;
    }

    console.log('📊 CURRENT STATE:\n');
    console.log(`   Total Earnings: ${financial.totalEarnings}`);
    console.log(`   Total Transactions: ${financial.transactions.length}`);
    
    // Calculate total of deleted transactions
    const totalDeleted = deletedTransactions.reduce((sum, t) => sum + t.amount, 0);
    console.log(`\n📋 TRANSACTIONS TO RESTORE (${deletedTransactions.length}):\n`);
    
    deletedTransactions.forEach((t, i) => {
      console.log(`   [${i + 1}] Amount: ${t.amount}, Description: "${t.description}"`);
    });

    console.log(`\n   💰 Total amount to restore: ${totalDeleted}\n`);

    if (dryRun) {
      console.log('🔒 DRY RUN - no changes made');
      console.log('\nTo restore, run: node restoreTransactions.js --apply\n');
      console.log(`After restore:`);
      console.log(`   New Total Earnings: ${financial.totalEarnings + totalDeleted}`);
      console.log(`   New Transaction Count: ${financial.transactions.length + deletedTransactions.length}\n`);
      return;
    }

    // Apply restore
    console.log('🔧 RESTORING TRANSACTIONS...\n');
    
    const now = new Date();
    for (const txn of deletedTransactions) {
      financial.transactions.push({
        amount: txn.amount,
        description: txn.description,
        date: now,
        paymentMethod: 'Cash',
        discount: 0,
        discountPercent: 0,
        totalDebtBeforeDiscount: 0
      });
      console.log(`   ✅ Restored: ${txn.amount} (${txn.description})`);
    }

    // Update total earnings
    financial.totalEarnings = financial.totalEarnings + totalDeleted;

    financial.markModified('transactions');
    await financial.save();

    console.log(`\n✅ SUCCESS!`);
    console.log(`   Old total: ${financial.totalEarnings - totalDeleted}`);
    console.log(`   New total: ${financial.totalEarnings}`);
    console.log(`   Amount restored: ${totalDeleted}`);
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
console.log(`${applyFlag ? '⚡ APPLYING RESTORE' : '👀 DRY RUN MODE'}\n`);
console.log('═'.repeat(60) + '\n');

restoreTransactions(!applyFlag).then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
