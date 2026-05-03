/**
 * Reset financial data for مستوصف الشعب الطبي.
 *
 * Default mode is DRY RUN:
 *   node resetAlshaabFinancials.js
 *
 * Apply changes:
 *   node resetAlshaabFinancials.js --apply
 *
 * Scope:
 * - Clinic owner account ("المركز")
 * - Active clinic doctors
 * - Clinic staff: Accountant, Nurse, LabTech
 * - Financial records, appointment financial fields, lab-request financial fields
 *
 * Does not delete users, patients, medical records, lab results, prescriptions, or files.
 */

const mongoose = require('mongoose');

const User = require('./models/User');
const Clinic = require('./models/Clinic');
const Financial = require('./models/Financial');
const Appointment = require('./models/Appointment');
const LabRequest = require('./models/LabRequest');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';
const APPLY = process.argv.includes('--apply');

const uniqueIds = (ids) => [
  ...new Map(
    ids
      .filter(Boolean)
      .map((id) => [id.toString(), id])
  ).values()
];

const sum = (items, selector) => items.reduce((total, item) => total + (Number(selector(item)) || 0), 0);

async function findShaabClinic() {
  const clinics = await Clinic.find({
    $or: [
      { name: 'مستوصف الشعب الطبي' },
      { name: /الشعب|شعب|shaab|al.?shaab/i }
    ]
  }).sort({ createdAt: 1 });

  if (clinics.length === 0) {
    throw new Error('لم يتم العثور على مستوصف الشعب. تحقق من اسم العيادة في قاعدة البيانات.');
  }

  if (clinics.length > 1) {
    console.log('⚠️ تم العثور على أكثر من عيادة تطابق الشعب:');
    clinics.forEach((clinic) => console.log(`   - ${clinic.name} (${clinic._id})`));
    console.log('سيتم استخدام أول نتيجة. إذا هذا غير صحيح، عدّل شرط البحث في السكربت.');
  }

  return clinics[0];
}

async function getClinicAccountIds(clinic) {
  const activeDoctorIds = (clinic.doctors || [])
    .filter((doctor) => doctor.status !== 'inactive')
    .map((doctor) => doctor.doctorId);

  const activeStaffIds = (clinic.staff || [])
    .filter((staff) => staff.status !== 'inactive')
    .map((staff) => staff.userId);

  const usersWithClinicId = await User.find({
    clinicId: clinic._id,
    role: { $in: ['Accountant', 'Nurse', 'LabTech'] }
  }).select('_id');

  const staffIdsFromUser = usersWithClinicId.map((user) => user._id);

  return {
    ownerId: clinic.ownerId,
    doctorIds: uniqueIds(activeDoctorIds),
    staffIds: uniqueIds([...activeStaffIds, ...staffIdsFromUser]),
    allAccountIds: uniqueIds([clinic.ownerId, ...activeDoctorIds, ...activeStaffIds, ...staffIdsFromUser])
  };
}

async function preview(clinic, ids) {
  const appointmentFilter = {
    $or: [
      { clinicId: clinic._id },
      { doctorId: { $in: ids.doctorIds } },
      { createdBy: { $in: ids.allAccountIds } }
    ]
  };

  const labFilter = {
    $or: [
      { clinicId: clinic._id },
      { doctorId: { $in: ids.doctorIds } },
      { labId: { $in: ids.staffIds } },
      { requestedBy: { $in: ids.allAccountIds } },
      { approvedBy: { $in: ids.allAccountIds } },
      { paidBy: { $in: ids.allAccountIds } }
    ]
  };

  const financialDocs = await Financial.find({
    $or: [
      { doctorId: { $in: ids.allAccountIds } },
      { pharmacyId: { $in: ids.allAccountIds } }
    ]
  });

  const appointments = await Appointment.find(appointmentFilter).select(
    'appointmentFee clinicFee doctorFee paymentAmount debt isPaid doctorPaidAmount'
  );

  const labRequests = await LabRequest.find(labFilter).select(
    'totalCost originalCost discountAmount paidAmount isPaid'
  );

  const users = await User.find({ _id: { $in: ids.allAccountIds } }).select('fullName role mobileNumber');

  return {
    appointmentFilter,
    labFilter,
    financialDocs,
    users,
    summary: {
      accounts: users.length,
      financialDocs: financialDocs.length,
      financialTransactions: financialDocs.reduce((count, doc) => count + (doc.transactions || []).length, 0),
      financialDebts: financialDocs.reduce((count, doc) => count + (doc.debts || []).length, 0),
      financialExpenses: financialDocs.reduce((count, doc) => count + (doc.expenses || []).length, 0),
      totalEarnings: sum(financialDocs, (doc) => doc.totalEarnings),
      totalExpenses: sum(financialDocs, (doc) => doc.totalExpenses),
      appointments: appointments.length,
      appointmentFees: sum(appointments, (apt) => (apt.clinicFee || apt.appointmentFee || 0) + (apt.doctorFee || 0)),
      appointmentPayments: sum(appointments, (apt) => apt.paymentAmount),
      appointmentDebts: sum(appointments, (apt) => apt.debt),
      labRequests: labRequests.length,
      labCosts: sum(labRequests, (req) => req.totalCost || req.originalCost),
      labPayments: sum(labRequests, (req) => req.paidAmount)
    }
  };
}

async function resetFinancialDocs(financialDocs) {
  for (const doc of financialDocs) {
    doc.totalEarnings = 0;
    doc.totalExpenses = 0;
    doc.transactions = [];
    doc.debts = [];
    doc.expenses = [];
    doc.markModified('transactions');
    doc.markModified('debts');
    doc.markModified('expenses');
    await doc.save();
  }
}

async function applyReset(context) {
  await resetFinancialDocs(context.financialDocs);

  await Appointment.updateMany(context.appointmentFilter, {
    $set: {
      isPaid: false,
      paymentAmount: 0,
      paidAt: null,
      autoMarkedAsPaid: false,
      appointmentFee: 0,
      debt: 0,
      debtStatus: 'none',
      doctorFee: 0,
      clinicFee: 0,
      clinicPercentage: 0,
      clinicShare: 0,
      doctorShare: 0,
      doctorPaid: false,
      doctorPaidAt: null,
      doctorPaidAmount: 0
    }
  });

  await LabRequest.updateMany(context.labFilter, {
    $set: {
      totalCost: 0,
      originalCost: 0,
      discount: 0,
      discountAmount: 0,
      isPaid: false,
      paidAmount: 0,
      paidAt: null,
      paidBy: null
    }
  });
}

async function main() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

  const clinic = await findShaabClinic();
  const ids = await getClinicAccountIds(clinic);
  const context = await preview(clinic, ids);

  console.log('\nمستوصف الشعب المراد تصفيره:');
  console.log(`- الاسم: ${clinic.name}`);
  console.log(`- ID: ${clinic._id}`);

  console.log('\nالحسابات المشمولة:');
  context.users.forEach((user) => {
    console.log(`- ${user.fullName || 'بدون اسم'} | ${user.role} | ${user.mobileNumber || '-'} | ${user._id}`);
  });

  console.log('\nملخص ما سيتم تصفيره:');
  console.table(context.summary);

  if (!APPLY) {
    console.log('\nDRY RUN فقط. لم يتم تعديل قاعدة البيانات.');
    console.log('للتنفيذ الفعلي شغّل: node resetAlshaabFinancials.js --apply');
    return;
  }

  console.log('\n⚠️ تنفيذ التصفير الفعلي...');
  await applyReset(context);

  const after = await preview(clinic, ids);
  console.log('\nتم التصفير. ملخص بعد التنفيذ:');
  console.table(after.summary);
}

main()
  .catch((error) => {
    console.error('\nفشل السكربت:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
