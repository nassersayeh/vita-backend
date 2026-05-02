// deletePatientDebts.js - Delete debts from specific patients for Shabab Medical Center
const mongoose = require('mongoose');
const Clinic = require('./models/Clinic');
const Financial = require('./models/Financial');
const Appointment = require('./models/Appointment');
const User = require('./models/User');

const MONGODB_URI = 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB\n');

  // Find the clinic
  const clinic = await Clinic.findOne({ name: 'مستوصف الشعب الطبي' });
  if (!clinic) {
    console.error('❌ لم يتم العثور على المركز');
    process.exit(1);
  }

  console.log(`📍 المركز: ${clinic.name}\n`);

  // Phone numbers to delete debts for
  const phoneNumbers = ['0597621329', '0568532404', '0568661206'];
  
  console.log('🔍 البحث عن المرضى:\n');

  // Find patients by phone
  const patients = await User.find({
    mobileNumber: { $in: phoneNumbers },
    role: 'User'
  });

  if (patients.length === 0) {
    console.log('❌ لم يتم العثور على أي مرضى بهذه الأرقام\n');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`✅ تم العثور على ${patients.length} مريض(ة):\n`);
  const patientIds = [];
  patients.forEach(p => {
    console.log(`👤 ${p.fullName}`);
    console.log(`   📱 رقم الهاتف: ${p.mobileNumber}`);
    console.log(`   ID: ${p._id}\n`);
    patientIds.push(p._id);
  });

  console.log('\n' + '='.repeat(60));
  console.log('🔍 البحث عن الديون من الحسابات المالية:\n');

  // Get all staff and doctors
  const staffUserIds = clinic.staff.map(s => s.userId);
  const doctorUserIds = clinic.doctors.map(d => d.doctorId);
  const allUserIds = [...staffUserIds, ...doctorUserIds, clinic.ownerId].filter(Boolean);

  // Get all financial records
  const financialRecords = await Financial.find({
    $or: [
      { doctorId: { $in: allUserIds } },
      { pharmacyId: { $in: allUserIds } }
    ]
  });

  let totalDeletedDebts = 0;
  let deletedDebtsCount = 0;
  const debtsToDelete = [];

  // Find debts to delete
  for (const record of financialRecords) {
    if (record.debts && record.debts.length > 0) {
      const debtsToKeep = [];
      
      for (const debt of record.debts) {
        const isPatientInList = patientIds.some(pId => pId.toString() === debt.patientId?.toString());
        
        if (isPatientInList) {
          const patient = patients.find(p => p._id.toString() === debt.patientId?.toString());
          console.log(`💳 وجدنا دين:\n   المريض: ${patient?.fullName}`);
          console.log(`   المبلغ: ${debt.amount} ₪`);
          console.log(`   الوصف: ${debt.description || 'دين يدوي'}`);
          console.log(`   الحالة: ${debt.status === 'pending' ? '⏳ مستحقة' : '✅ مدفوعة'}`);
          console.log(`   التاريخ: ${new Date(debt.date).toLocaleDateString('ar-SA')}`);
          console.log(`   ID الدين: ${debt._id}\n`);
          
          debtsToDelete.push({
            recordId: record._id,
            debtId: debt._id,
            amount: debt.amount,
            patientName: patient?.fullName,
            doctorOrPharmacy: record.doctorId || record.pharmacyId
          });
          
          totalDeletedDebts += debt.amount || 0;
          deletedDebtsCount++;
        } else {
          debtsToKeep.push(debt);
        }
      }
      
      // Update only if we need to remove debts
      if (debtsToKeep.length !== record.debts.length) {
        record.debts = debtsToKeep;
      }
    }
  }

  if (debtsToDelete.length === 0) {
    console.log('✅ لا توجد ديون لحذفها\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 ملخص الديون المراد حذفها:\n');
  console.log(`إجمالي الديون: ${deletedDebtsCount} دين`);
  console.log(`إجمالي المبلغ: ${totalDeletedDebts} ₪\n`);

  // Also check appointments for debts
  console.log('\n' + '='.repeat(60));
  console.log('🔍 البحث عن ديون المواعيد:\n');

  const doctorIds = clinic.doctors.map(d => d.doctorId);
  const appointmentsWithDebt = await Appointment.find({
    patient: { $in: patientIds },
    doctorId: { $in: doctorIds },
    debt: { $gt: 0 }
  });

  let appointmentDebtsCount = 0;
  let totalAppointmentDebts = 0;

  appointmentsWithDebt.forEach(a => {
    console.log(`📋 موعد:`);
    console.log(`   المريض: ${a.patient}`);
    console.log(`   الدين: ${a.debt} ₪`);
    console.log(`   التاريخ: ${new Date(a.appointmentDateTime).toLocaleDateString('ar-SA')}`);
    console.log(`   ID: ${a._id}\n`);
    
    appointmentDebtsCount++;
    totalAppointmentDebts += a.debt || 0;
  });

  if (appointmentDebtsCount === 0) {
    console.log('✅ لا توجد ديون من المواعيد\n');
  } else {
    console.log(`\n📊 ملخص ديون المواعيد:\n`);
    console.log(`إجمالي: ${appointmentDebtsCount} موعد`);
    console.log(`إجمالي المبلغ: ${totalAppointmentDebts} ₪\n`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('❓ هل تريد حقاً حذف هذه الديون؟\n');
  console.log('الإجراءات المطلوبة:\n');
  console.log(`1️⃣  حذف ${deletedDebtsCount} دين من الحسابات المالية = ${totalDeletedDebts} ₪`);
  if (appointmentDebtsCount > 0) {
    console.log(`2️⃣  حذف ${appointmentDebtsCount} موعد مع ديون = ${totalAppointmentDebts} ₪`);
  }
  console.log('\n' + '='.repeat(60));
  
  // Perform the deletion
  console.log('\n🔄 جاري حذف الديون...\n');

  // Delete debts from financial records
  let financialUpdatedCount = 0;
  for (const record of financialRecords) {
    if (record.debts && record.debts.length > 0) {
      const initialCount = record.debts.length;
      record.debts = record.debts.filter(d => 
        !patientIds.some(pId => pId.toString() === d.patientId?.toString())
      );
      
      if (record.debts.length < initialCount) {
        await record.save();
        financialUpdatedCount++;
        console.log(`✅ تم تحديث حساب مالي (حذفنا ${initialCount - record.debts.length} دين)`);
      }
    }
  }

  // Delete debt from appointments
  if (appointmentDebtsCount > 0) {
    const result = await Appointment.updateMany(
      {
        patient: { $in: patientIds },
        doctorId: { $in: doctorIds },
        debt: { $gt: 0 }
      },
      {
        $set: {
          debt: 0,
          debtStatus: 'none',
          isPaid: true
        }
      }
    );
    console.log(`✅ تم تحديث ${result.modifiedCount} موعد (حذفنا الديون)`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ تم حذف جميع الديون بنجاح!\n');
  console.log('📝 الملخص:\n');
  console.log(`• تم حذف ${deletedDebtsCount} دين من الحسابات المالية`);
  console.log(`• المبلغ المحذوف: ${totalDeletedDebts} ₪`);
  if (appointmentDebtsCount > 0) {
    console.log(`• تم تصفير ${appointmentDebtsCount} موعد مع ديون`);
    console.log(`• المبلغ المحذوف من المواعيد: ${totalAppointmentDebts} ₪`);
  }
  console.log(`• إجمالي المبلغ المحذوف: ${totalDeletedDebts + totalAppointmentDebts} ₪\n`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
