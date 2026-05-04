#!/usr/bin/env node

/**
 * Simple script to identify and remove duplicate Financial transactions
 * that don't have appointmentIds associated with them
 */

const mongoose = require('mongoose');
const Financial = require('./models/Financial');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function cleanupAlshaab(dryRun = true) {
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

    console.log('📊 FINANCIAL DATA FOR ALSHAAB:\n');
    console.log(`   Total Earnings: ${financial.totalEarnings}`);
    console.log(`   Total Transactions: ${financial.transactions.length}`);
    console.log(`   Total Expenses: ${financial.totalExpenses}\n`);

    // Group transactions by date and amount to find patterns
    const transactionGroups = new Map();
    
    financial.transactions.forEach((txn, idx) => {
      const date = new Date(txn.date).toDateString();
      const amount = txn.amount;
      const key = `${date}|${amount}`;
      
      if (!transactionGroups.has(key)) {
        transactionGroups.set(key, []);
      }
      transactionGroups.get(key).push({ idx, txn });
    });

    // Find duplicate amounts on same day
    console.log('🔍 LOOKING FOR DUPLICATES:\n');
    
    let duplicatesToRemove = [];
    let totalDuplicateAmount = 0;

    for (const [key, items] of transactionGroups) {
      if (items.length > 1) {
        const [date, amount] = key.split('|');
        
        // Check if these are all "دفعة من مريض" type transactions
        const allPaymentType = items.every(item => 
          item.txn.description === 'دفعة من مريض' || 
          item.txn.description?.includes('دفعة')
        );
        
        if (allPaymentType) {
          console.log(`⚠️  DUPLICATE FOUND:`);
          console.log(`   Date: ${date}, Amount: ${amount}`);
          console.log(`   Count: ${items.length} transactions with same amount on same day\n`);
          
          // Mark the extras for removal (keep only the first one)
          for (let i = 1; i < items.length; i++) {
            duplicatesToRemove.push(items[i].idx);
            totalDuplicateAmount += items[i].txn.amount;
          }
        }
      }
    }

    if (duplicatesToRemove.length === 0) {
      console.log('✅ No duplicates found!\n');
      return;
    }

    console.log(`\n📋 SUMMARY:`);
    console.log(`   Duplicate transactions to remove: ${duplicatesToRemove.length}`);
    console.log(`   Total amount: ${totalDuplicateAmount}\n`);

    if (dryRun) {
      console.log('🔒 DRY RUN - no changes made');
      console.log('\nTo apply fixes, run: node cleanupAlshaab.js --apply\n');
      return;
    }

    // Apply fixes
    console.log('🔧 REMOVING DUPLICATES...\n');
    
    // Remove in reverse order to preserve indices
    duplicatesToRemove.sort((a, b) => b - a); // Sort descending
    for (const idx of duplicatesToRemove) {
      if (idx < financial.transactions.length) {
        const txn = financial.transactions[idx];
        console.log(`   ✅ Removing: ${txn.amount} (${txn.description})`);
        financial.transactions.splice(idx, 1);
      }
    }

    // Update total earnings
    const newTotal = financial.transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    financial.totalEarnings = newTotal;

    financial.markModified('transactions');
    await financial.save();

    console.log(`\n✅ SUCCESS!`);
    console.log(`   Old total: ${financial.totalEarnings + totalDuplicateAmount}`);
    console.log(`   New total: ${newTotal}`);
    console.log(`   Amount removed: ${totalDuplicateAmount}\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Main
const applyFlag = process.argv.includes('--apply');
cleanupAlshaab(!applyFlag).then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
