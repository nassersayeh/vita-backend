#!/usr/bin/env node

/**
 * Script to add the missing 25 shekel to reach 1075 total
 */

const mongoose = require('mongoose');
const Financial = require('./models/Financial');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function addMissingAmount(dryRun = true) {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected\n');

    const clinicOwnerId = '69ce33c830727c24d322fdeb';

    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    
    if (!financial) {
      console.log('❌ No financial record found');
      return;
    }

    console.log('📊 CURRENT STATE:\n');
    console.log(`   Current Total Earnings: ${financial.totalEarnings}`);
    console.log(`   Target Total Earnings: 1075`);
    console.log(`   Missing Amount: ${1075 - financial.totalEarnings}`);

    const missingAmount = 1075 - financial.totalEarnings;

    if (missingAmount === 0) {
      console.log(`\n✅ Already at target amount!\n`);
      return;
    }

    console.log(`\n📋 ACTION:\n`);
    console.log(`   Adding ${missingAmount} shekel payment\n`);

    if (dryRun) {
      console.log('🔒 DRY RUN - no changes made');
      console.log('\nTo add payment, run: node addMissingAmount.js --apply\n');
      console.log(`After addition:`);
      console.log(`   New Total Earnings: 1075`);
      console.log(`   New Transaction Count: ${financial.transactions.length + 1}\n`);
      return;
    }

    // Apply addition
    console.log('🔧 ADDING PAYMENT...\n');
    
    financial.transactions.push({
      amount: missingAmount,
      description: 'دفعة مريض',
      date: new Date(),
      paymentMethod: 'Cash',
      discount: 0,
      discountPercent: 0,
      totalDebtBeforeDiscount: 0
    });

    financial.totalEarnings = 1075;

    financial.markModified('transactions');
    await financial.save();

    console.log(`✅ SUCCESS!`);
    console.log(`   Added: ${missingAmount} shekel`);
    console.log(`   Old total: ${financial.totalEarnings - missingAmount}`);
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
console.log(`${applyFlag ? '⚡ APPLYING ADDITION' : '👀 DRY RUN MODE'}\n`);
console.log('═'.repeat(60) + '\n');

addMissingAmount(!applyFlag).then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
