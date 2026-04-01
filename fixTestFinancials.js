/**
 * سكريبت إصلاح البيانات المالية لحسابات الاختبار
 * يصلح: عيادة الاختبار + د. سامي الاختبار + خالد المحاسب
 * 
 * يعمل التالي:
 * 1. يمسح كل البيانات المالية القديمة (transactions, debts, expenses)
 * 2. يمسح كل المواعيد القديمة 
 * 3. يعيد totalEarnings و totalExpenses إلى 0
 * 4. يصلح clinicId المفقود على المواعيد
 * 5. يعيد إنشاء بيانات تجريبية نظيفة تتبع الفلو الصحيح
 */

const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.vefyn0g.mongodb.net/?appName=Cluster0')
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => { console.error('❌ Connection error:', err); process.exit(1); });

const User = require('./models/User');
const Clinic = require('./models/Clinic');
const Financial = require('./models/Financial');
const Appointment = require('./models/Appointment');
const MedicalRecord = require('./models/MedicalRecord');

async function fixTestData() {
  try {
    // ==================== IDs ====================
    const clinicId = '69ab71a55e38c0f8791592b9';           // عيادة الاختبار
    const clinicOwnerId = '69ab71a45e38c0f8791592a3';      // صاحب العيادة (Clinic role)
    const doctorId = '69ab71a45e38c0f8791592a6';           // د. سامي الاختبار
    const patientId = '69ac70bc24a1a9041260d9a9';          // مريض ١

    console.log('\n🔍 Verifying test accounts...');
    
    const clinic = await Clinic.findById(clinicId);
    const clinicOwner = await User.findById(clinicOwnerId);
    const doctor = await User.findById(doctorId);
    const patient = await User.findById(patientId);
    
    if (!clinic) throw new Error('Clinic not found!');
    if (!clinicOwner) throw new Error('Clinic owner not found!');
    if (!doctor) throw new Error('Doctor not found!');
    if (!patient) throw new Error('Patient not found!');
    
    console.log(`  عيادة: ${clinic.name}`);
    console.log(`  مالك العيادة: ${clinicOwner.fullName} (${clinicOwner.email})`);
    console.log(`  طبيب: ${doctor.fullName} (${doctor.email})`);
    console.log(`  مريض: ${patient.fullName}`);

    // ==================== STEP 1: Clean old data ====================
    console.log('\n🧹 Step 1: Cleaning old data...');

    // Delete all appointments for this doctor
    const deletedApts = await Appointment.deleteMany({ doctorId });
    console.log(`  ✓ Deleted ${deletedApts.deletedCount} old appointments`);

    // Delete all medical records for this doctor
    const deletedRecords = await MedicalRecord.deleteMany({ doctor: doctorId });
    console.log(`  ✓ Deleted ${deletedRecords.deletedCount} old medical records`);

    // Reset clinic owner's Financial
    let clinicFinancial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (clinicFinancial) {
      clinicFinancial.totalEarnings = 0;
      clinicFinancial.totalExpenses = 0;
      clinicFinancial.transactions = [];
      clinicFinancial.debts = [];
      clinicFinancial.expenses = [];
      await clinicFinancial.save();
      console.log('  ✓ Reset clinic owner Financial record');
    } else {
      clinicFinancial = new Financial({ 
        doctorId: clinicOwnerId, 
        totalEarnings: 0, 
        totalExpenses: 0,
        transactions: [],
        debts: [],
        expenses: []
      });
      await clinicFinancial.save();
      console.log('  ✓ Created new clinic owner Financial record');
    }

    // Reset doctor's Financial (if exists)
    let doctorFinancial = await Financial.findOne({ doctorId: doctorId });
    if (doctorFinancial) {
      doctorFinancial.totalEarnings = 0;
      doctorFinancial.totalExpenses = 0;
      doctorFinancial.transactions = [];
      doctorFinancial.debts = [];
      doctorFinancial.expenses = [];
      await doctorFinancial.save();
      console.log('  ✓ Reset doctor Financial record');
    }

    // ==================== STEP 2: Set clinic percentage ====================
    console.log('\n⚙️  Step 2: Setting clinic percentage...');
    
    const doctorEntry = clinic.doctors.find(d => d.doctorId.toString() === doctorId);
    if (doctorEntry) {
      doctorEntry.clinicPercentage = 15;
      await clinic.save();
      console.log('  ✓ Clinic percentage set to 15%');
    }

    // ==================== STEP 3: Create clean test scenarios ====================
    console.log('\n📋 Step 3: Creating clean test data...');

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // ------ SCENARIO 1: Completed & Paid appointment ------
    // Flow: Accountant creates → Doctor sets fee → Patient pays → Completed
    console.log('\n  📌 Scenario 1: Completed + Paid appointment');
    
    const apt1 = new Appointment({
      doctorId,
      patient: patientId,
      appointmentDateTime: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
      durationMinutes: 30,
      reason: 'فحص عام - زيارة أولى',
      status: 'completed',
      clinicId,
      workplaceName: clinic.name,
      // Clinic fee (كشفية) set by accountant
      appointmentFee: 15,
      clinicFee: 15,
      // Doctor fee set by doctor
      doctorFee: 50,
      // Patient paid everything
      isPaid: true,
      paymentAmount: 65, // 15 + 50
      paidAt: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000 + 3600000),
      debt: 0,
      debtStatus: 'none',
      // Financial split (15% clinic from doctor fee)
      clinicPercentage: 15,
      clinicShare: 15 + 7.5,  // clinicFee + 15% of doctorFee
      doctorShare: 42.5,       // 50 - 7.5
    });
    await apt1.save();
    console.log('    ✓ Appointment created (ID:', apt1._id + ')');

    // Record in clinic's Financial: full payment received
    clinicFinancial.transactions.push({
      amount: 65,
      description: `إتمام موعد - ${clinic.name} (كشفية: ₪15 + رسوم طبيب: ₪50)`,
      date: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000 + 3600000),
      patientId,
      appointmentId: apt1._id,
      paymentMethod: 'Cash',
    });
    clinicFinancial.totalEarnings += 65;

    // Debts were created then paid (store them as paid)
    clinicFinancial.debts.push({
      patientId,
      amount: 0,
      description: 'كشفية العيادة - فحص عام - زيارة أولى',
      date: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000),
      status: 'paid'
    });
    clinicFinancial.debts.push({
      patientId,
      amount: 0,
      description: `رسوم الطبيب - ${patient.fullName} - ${apt1._id}`,
      date: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000),
      status: 'paid'
    });

    // Medical record for this appointment
    const record1 = new MedicalRecord({
      patient: patientId,
      doctor: doctorId,
      date: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000),
      recordType: 'initial',
      visitNumber: 1,
      title: 'فحص عام - زيارة أولى',
      chiefComplaint: 'صداع متكرر ودوخة',
      diagnosis: 'ارتفاع ضغط الدم الأولي',
      treatmentPlan: 'أدوية ضغط + مراجعة بعد أسبوع',
      medications: 'أملوديبين 5mg يومياً',
      notes: 'يجب متابعة قياس الضغط يومياً',
    });
    await record1.save();
    console.log('    ✓ Medical record created');


    // ------ SCENARIO 2: Confirmed appointment with pending debt ------
    // Flow: Accountant creates with clinicFee → Doctor set fee → Patient hasn't paid yet
    console.log('\n  📌 Scenario 2: Confirmed + has debt (not paid)');
    
    const apt2 = new Appointment({
      doctorId,
      patient: patientId,
      appointmentDateTime: new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000), // yesterday
      durationMinutes: 30,
      reason: 'مراجعة - متابعة ضغط',
      status: 'confirmed',
      clinicId,
      workplaceName: clinic.name,
      // Clinic fee set by accountant on accept
      appointmentFee: 15,
      clinicFee: 15,
      // Doctor set fee after examination
      doctorFee: 35,
      // Not paid yet
      isPaid: false,
      paymentAmount: 0,
      debt: 50, // 15 + 35
      debtStatus: 'full',
    });
    await apt2.save();
    console.log('    ✓ Appointment created (ID:', apt2._id + ')');

    // Debts in Financial (pending)
    clinicFinancial.debts.push({
      patientId,
      amount: 15,
      description: 'كشفية العيادة - مراجعة - متابعة ضغط',
      date: new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000),
      status: 'pending'
    });
    clinicFinancial.debts.push({
      patientId,
      amount: 35,
      description: `رسوم الطبيب - ${patient.fullName} - ${apt2._id}`,
      date: new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000),
      status: 'pending'
    });

    // Medical record for follow-up
    const record2 = new MedicalRecord({
      patient: patientId,
      doctor: doctorId,
      date: new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000),
      recordType: 'followup',
      parentRecord: record1._id,
      visitNumber: 2,
      title: 'متابعة - ضغط الدم',
      chiefComplaint: 'متابعة قياس ضغط الدم',
      diagnosis: 'تحسن في ضغط الدم - 130/85',
      treatmentPlan: 'استمرار العلاج الحالي',
      medications: 'أملوديبين 5mg يومياً',
      notes: 'الضغط تحسن - مراجعة بعد شهر',
      followUpNotes: {
        progressStatus: 'improved',
        progressDescription: 'الضغط انخفض من 150/95 إلى 130/85',
        treatmentChanges: 'لا تغيير',
        patientCompliance: 'good',
        complianceNotes: 'المريض يأخذ الدواء بانتظام',
      }
    });
    await record2.save();
    console.log('    ✓ Follow-up medical record created');


    // ------ SCENARIO 3: Today's appointment - just accepted ------
    // Flow: Patient booked → Accountant accepted with fee → Waiting for doctor
    console.log('\n  📌 Scenario 3: Today - accepted, waiting for doctor');
    
    const apt3 = new Appointment({
      doctorId,
      patient: patientId,
      appointmentDateTime: new Date(today.getTime() + 10 * 60 * 60 * 1000), // today 10:00 AM
      durationMinutes: 30,
      reason: 'فحص دوري',
      status: 'confirmed',
      clinicId,
      workplaceName: clinic.name,
      appointmentFee: 20,
      clinicFee: 20,
      // Doctor hasn't seen patient yet - no doctor fee
      doctorFee: 0,
      isPaid: false,
      paymentAmount: 0,
      debt: 20,
      debtStatus: 'full',
    });
    await apt3.save();
    console.log('    ✓ Appointment created (ID:', apt3._id + ')');

    // Debt for clinic fee only
    clinicFinancial.debts.push({
      patientId,
      amount: 20,
      description: 'كشفية العيادة - فحص دوري',
      date: today,
      status: 'pending'
    });


    // ==================== STEP 4: Save all financial data ====================
    console.log('\n💾 Step 4: Saving financial data...');
    
    clinicFinancial.markModified('transactions');
    clinicFinancial.markModified('debts');
    await clinicFinancial.save();
    console.log('  ✓ Clinic financial saved');

    // ==================== STEP 5: Verify ====================
    console.log('\n✅ Verification:');
    
    const finalFinancial = await Financial.findOne({ doctorId: clinicOwnerId });
    const finalApts = await Appointment.find({ doctorId }).sort({ appointmentDateTime: 1 });
    const finalRecords = await MedicalRecord.find({ doctor: doctorId });
    
    console.log(`  Total Earnings: ₪${finalFinancial.totalEarnings}`);
    console.log(`  Total Expenses: ₪${finalFinancial.totalExpenses}`);
    console.log(`  Transactions: ${finalFinancial.transactions.length}`);
    console.log(`  Debts total: ${finalFinancial.debts.length} entries`);
    
    const pendingDebts = finalFinancial.debts.filter(d => d.status === 'pending');
    const paidDebts = finalFinancial.debts.filter(d => d.status === 'paid');
    const totalPendingDebt = pendingDebts.reduce((sum, d) => sum + d.amount, 0);
    console.log(`    - Pending: ${pendingDebts.length} (₪${totalPendingDebt})`);
    console.log(`    - Paid: ${paidDebts.length}`);
    
    console.log(`  Appointments: ${finalApts.length}`);
    finalApts.forEach((a, i) => {
      const totalFee = (a.clinicFee || 0) + (a.doctorFee || 0);
      console.log(`    ${i+1}. ${a.reason} | status: ${a.status} | fee: ₪${totalFee} (clinic:${a.clinicFee} + doctor:${a.doctorFee}) | paid: ${a.isPaid} | debt: ₪${a.debt}`);
    });
    
    console.log(`  Medical Records: ${finalRecords.length}`);
    finalRecords.forEach((r, i) => {
      console.log(`    ${i+1}. ${r.title} | type: ${r.recordType} | diagnosis: ${r.diagnosis}`);
    });

    console.log('\n📊 Summary:');
    console.log(`  💰 Revenue (earned): ₪${finalFinancial.totalEarnings}`);
    console.log(`  🔴 Outstanding debt: ₪${totalPendingDebt}`);
    console.log(`  📋 Active appointments: ${finalApts.filter(a => a.status === 'confirmed').length}`);
    console.log(`  ✅ Completed appointments: ${finalApts.filter(a => a.status === 'completed').length}`);
    
    console.log('\n🎉 Test data fix completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

fixTestData();
