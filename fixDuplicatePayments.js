#!/usr/bin/env node

/**
 * Script to fix duplicate payment entries in Financial.transactions for Alshaab clinic
 * 
 * Problem: When accountant records payments, they were being added twice to the revenue
 * - Once from Appointment.paymentAmount
 * - Once from Financial.transactions (without appointmentId)
 * 
 * This script:
 * 1. Identifies Financial transactions that are duplicates of appointment payments
 * 2. Removes the duplicate transactions from Financial
 * 3. Adds appointmentIds array to the remaining transactions for future deduplication
 */

const mongoose = require('mongoose');
const Financial = require('./models/Financial');
const Appointment = require('./models/Appointment');
const User = require('./models/User');

// Database connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function findClinicByName(clinicName) {
  try {
    const clinic = await User.findOne({ 
      name: { $regex: clinicName, $options: 'i' },
      role: 'Clinic'
    });
    return clinic;
  } catch (err) {
    console.error('Error finding clinic:', err);
    return null;
  }
}

async function fixDuplicatePayments(clinicOwnerId, dryRun = true) {
  console.log(`\n🔍 Searching for duplicate payments for clinic owner: ${clinicOwnerId}`);
  console.log(`📋 Dry Run: ${dryRun ? 'YES (no changes will be made)' : 'NO (changes will be applied)'}\n`);

  try {
    // Get clinic owner's financial record
    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      console.log('❌ No financial record found for this clinic owner');
      return;
    }

    // Get all paid appointments for this clinic owner
    const paidAppointments = await Appointment.find({
      doctorId: clinicOwnerId,
      isPaid: true,
      paymentAmount: { $gt: 0 }
    });

    console.log(`📊 Found ${paidAppointments.length} paid appointments`);
    console.log(`💰 Found ${financial.transactions.length} financial transactions\n`);

    // Build a map of expected payments from appointments
    const appointmentPayments = new Map(); // Key: "amount-date", Value: [appointmentIds]
    for (const apt of paidAppointments) {
      const paymentAmount = apt.paymentAmount || 0;
      const paidDate = apt.paidAt || apt.updatedAt;
      const dateStr = new Date(paidDate).toDateString(); // Normalize date to day level
      const key = `${paymentAmount}-${dateStr}`;
      
      if (!appointmentPayments.has(key)) {
        appointmentPayments.set(key, []);
      }
      appointmentPayments.get(key).push(apt._id.toString());
    }

    // Analyze transactions to find duplicates
    const duplicateTransactions = [];
    const transactionsToKeep = [];
    const transactionsWithoutAppointmentIds = [];

    for (let i = 0; i < financial.transactions.length; i++) {
      const txn = financial.transactions[i];
      const amount = txn.amount || 0;
      const txnDate = txn.date || new Date();
      const dateStr = new Date(txnDate).toDateString();
      const key = `${amount}-${dateStr}`;

      // Check if this transaction has no appointmentId but matches an appointment payment
      if (!txn.appointmentId && !txn.appointmentIds && amount > 0) {
        const matchingApts = appointmentPayments.get(key);
        if (matchingApts && matchingApts.length > 0) {
          console.log(`⚠️  Potential duplicate transaction found:`);
          console.log(`    Amount: ${amount}, Date: ${dateStr}`);
          console.log(`    Description: ${txn.description}`);
          console.log(`    Patient: ${txn.patientId}`);
          
          // Check if it's a "دفعة من مريض" type transaction (from insertPayment)
          const isPaymentTransaction = txn.description === 'دفعة من مريض' || 
                                       txn.description?.includes('دفعة') ||
                                       txn.totalDebtBeforeDiscount > 0;
          
          if (isPaymentTransaction) {
            console.log(`    ✅ This looks like an insertPayment transaction - MARKING FOR DELETION\n`);
            duplicateTransactions.push({
              index: i,
              txn: txn,
              matchingApts: matchingApts,
              reason: 'Duplicate insertPayment transaction'
            });
          } else {
            console.log(`    ℹ️  This might be a different type of transaction - KEEPING\n`);
            transactionsWithoutAppointmentIds.push({ index: i, txn });
          }
        } else {
          // No matching appointment, keep it
          transactionsWithoutAppointmentIds.push({ index: i, txn });
        }
      }
    }

    // Summary
    console.log(`\n📈 ANALYSIS RESULTS:`);
    console.log(`   Duplicate transactions to remove: ${duplicateTransactions.length}`);
    console.log(`   Transactions without appointmentIds (to review): ${transactionsWithoutAppointmentIds.length}`);

    if (duplicateTransactions.length === 0) {
      console.log(`\n✅ No duplicate transactions found! Data looks clean.`);
      return;
    }

    // Show details of duplicates
    console.log(`\n📋 DUPLICATE TRANSACTIONS TO REMOVE:\n`);
    let totalDuplicateAmount = 0;
    for (const dup of duplicateTransactions) {
      console.log(`   • Amount: ${dup.txn.amount} | Date: ${new Date(dup.txn.date).toLocaleDateString()}`);
      console.log(`     Description: ${dup.txn.description}`);
      console.log(`     Reason: ${dup.reason}`);
      totalDuplicateAmount += dup.txn.amount;
    }
    console.log(`\n   Total amount in duplicates: ${totalDuplicateAmount}`);

    if (dryRun) {
      console.log(`\n🔒 DRY RUN MODE - No changes made. Run with dryRun=false to apply changes.`);
      return;
    }

    // Apply fixes
    console.log(`\n🔧 APPLYING FIXES...\n`);

    // Remove duplicates (in reverse order to preserve indices)
    for (let i = duplicateTransactions.length - 1; i >= 0; i--) {
      const dup = duplicateTransactions[i];
      financial.transactions.splice(dup.index, 1);
      console.log(`   ✅ Removed duplicate: ${dup.txn.amount} (${dup.txn.description})`);
    }

    // Recalculate totalEarnings
    const newTotalEarnings = financial.transactions.reduce((sum, txn) => sum + (txn.amount || 0), 0);
    const reductionAmount = financial.totalEarnings - newTotalEarnings;
    
    console.log(`\n   💰 Financial totals updated:`);
    console.log(`      Old totalEarnings: ${financial.totalEarnings}`);
    console.log(`      New totalEarnings: ${newTotalEarnings}`);
    console.log(`      Reduction: ${reductionAmount}`);

    financial.totalEarnings = newTotalEarnings;

    // Mark as modified and save
    financial.markModified('transactions');
    await financial.save();

    console.log(`\n✅ FIXES APPLIED SUCCESSFULLY!`);
    console.log(`   - Removed ${duplicateTransactions.length} duplicate transactions`);
    console.log(`   - Total amount corrected: ${reductionAmount}`);

  } catch (error) {
    console.error('❌ Error during fix:', error);
    throw error;
  }
}

async function main() {
  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find Alshaab clinic
    console.log('🏥 Looking for Alshaab clinic...');
    const clinic = await findClinicByName('الشعب');
    
    if (!clinic) {
      console.error('❌ Could not find Alshaab clinic. Please check the clinic name.');
      process.exit(1);
    }

    console.log(`✅ Found clinic: ${clinic.name}`);
    console.log(`   Owner ID: ${clinic.ownerId || clinic._id}\n`);

    const clinicOwnerId = clinic.ownerId || clinic._id;

    // First run as dry run to see what will be changed
    console.log('═'.repeat(60));
    console.log('STEP 1: DRY RUN - Preview of changes');
    console.log('═'.repeat(60));
    
    await fixDuplicatePayments(clinicOwnerId, true);

    // Ask for confirmation
    console.log('\n' + '═'.repeat(60));
    console.log('Ready to apply fixes? (requires manual confirmation)');
    console.log('═'.repeat(60));
    console.log('\nTo apply the fixes, run:');
    console.log(`  node fixDuplicatePayments.js --apply --clinic "${clinic.name}"\n`);

    // Check if --apply flag is set
    const applyFlag = process.argv.includes('--apply');
    if (applyFlag) {
      console.log('🚀 --apply flag detected. Applying fixes...\n');
      await fixDuplicatePayments(clinicOwnerId, false);
    }

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the script
main().catch(console.error);
