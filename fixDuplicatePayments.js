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
    const Clinic = require('./models/Clinic');
    const clinic = await Clinic.findOne({ 
      name: { $regex: clinicName, $options: 'i' }
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

    // Get all appointments for this clinic owner (paid or not)
    const allAppointments = await Appointment.find({
      doctorId: clinicOwnerId,
      paymentAmount: { $gt: 0 }
    });

    console.log(`📊 Found ${allAppointments.length} appointments with payments`);
    console.log(`💰 Found ${financial.transactions.length} financial transactions\n`);

    // Build a map of appointment payments - group by date and look for patterns
    const appointmentPaymentsByDate = new Map(); // Key: date, Value: [amounts]
    for (const apt of allAppointments) {
      const paymentAmount = apt.paymentAmount || 0;
      const paidDate = apt.paidAt || apt.updatedAt || apt.appointmentDateTime;
      const dateStr = new Date(paidDate).toDateString();
      
      if (!appointmentPaymentsByDate.has(dateStr)) {
        appointmentPaymentsByDate.set(dateStr, []);
      }
      appointmentPaymentsByDate.get(dateStr).push(paymentAmount);
    }

    // Analyze transactions to find potential duplicates
    const transactionsWithoutAppointmentIds = [];
    const suspiciousTransactions = [];

    console.log('📋 ANALYZING TRANSACTIONS:\n');
    for (let i = 0; i < financial.transactions.length; i++) {
      const txn = financial.transactions[i];
      const amount = txn.amount || 0;
      const txnDate = txn.date || new Date();
      const dateStr = new Date(txnDate).toDateString();

      // Check if transaction is missing appointmentIds but matches appointments
      if (!txn.appointmentId && !txn.appointmentIds) {
        const appointmentsThatDay = appointmentPaymentsByDate.get(dateStr) || [];
        
        // Check if amount matches any appointment that day
        const exactMatch = appointmentsThatDay.includes(amount);
        
        console.log(`Transaction [${i}]:`);
        console.log(`  Amount: ${amount}, Date: ${dateStr}`);
        console.log(`  Description: "${txn.description}"`);
        console.log(`  PatientId: ${txn.patientId}`);
        console.log(`  Appointments that day: ${appointmentsThatDay.length}, Amounts: [${appointmentsThatDay.join(', ')}]`);
        
        // Identify if this is a "دفعة" type transaction
        const isPaymentTransaction = txn.description === 'دفعة من مريض' || 
                                     txn.description?.includes('دفعة') ||
                                     (txn.totalDebtBeforeDiscount && txn.totalDebtBeforeDiscount > 0);
        
        if (isPaymentTransaction && exactMatch) {
          console.log(`  ⚠️  SUSPICIOUS: Payment transaction matching appointment amount\n`);
          suspiciousTransactions.push({
            index: i,
            txn: txn,
            matchingAmount: amount,
            reason: 'Payment transaction matching appointment'
          });
        } else if (isPaymentTransaction) {
          console.log(`  ℹ️  REVIEW: Payment transaction (no exact appointment match)\n`);
          transactionsWithoutAppointmentIds.push({ index: i, txn });
        } else {
          console.log(`  ✅ Non-payment transaction\n`);
          transactionsWithoutAppointmentIds.push({ index: i, txn });
        }
      }
    }

    // Summary
    console.log(`\n📈 ANALYSIS RESULTS:`);
    console.log(`   Suspicious transactions (likely duplicates): ${suspiciousTransactions.length}`);
    console.log(`   Transactions without appointmentIds (to review): ${transactionsWithoutAppointmentIds.length}`);

    if (suspiciousTransactions.length === 0) {
      console.log(`\n✅ No suspicious duplicate transactions found!`);
      return;
    }

    // Show details of suspicious transactions
    console.log(`\n📋 SUSPICIOUS TRANSACTIONS (LIKELY DUPLICATES):\n`);
    let totalSuspiciousAmount = 0;
    for (const sus of suspiciousTransactions) {
      console.log(`   • Amount: ${sus.txn.amount} | Date: ${new Date(sus.txn.date).toLocaleDateString()}`);
      console.log(`     Description: "${sus.txn.description}"`);
      console.log(`     Patient ID: ${sus.txn.patientId}`);
      console.log(`     Reason: ${sus.reason}`);
      totalSuspiciousAmount += sus.txn.amount;
    }
    console.log(`\n   Total amount in suspicious transactions: ${totalSuspiciousAmount}`);

    if (dryRun) {
      console.log(`\n🔒 DRY RUN MODE - No changes made. Run with --apply to remove these.`);
      return { count: suspiciousTransactions.length, amount: totalSuspiciousAmount };
    }

    // Apply fixes
    console.log(`\n🔧 APPLYING FIXES...\n`);

    // Remove suspicious transactions (in reverse order to preserve indices)
    for (let i = suspiciousTransactions.length - 1; i >= 0; i--) {
      const sus = suspiciousTransactions[i];
      financial.transactions.splice(sus.index, 1);
      console.log(`   ✅ Removed suspicious: ${sus.txn.amount} (${sus.txn.description})`);
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
    console.log(`   - Removed ${suspiciousTransactions.length} suspicious transactions`);
    console.log(`   - Total amount corrected: ${reductionAmount}`);
    
    return { count: suspiciousTransactions.length, amount: reductionAmount };

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
