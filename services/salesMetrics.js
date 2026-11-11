const Prescription = require('../models/EPrescription');
const Controlled = require('../models/ControlledPrescription');
const Appointment = require('../models/Appointment');
const LabRequest = require('../models/LabRequest');
const MedicalRecord = require('../models/MedicalRecord');
const Quote = require('../models/PharmacyPrescriptionQuote');
const ControlledQuote = require('../models/ControlledQuote');
const User = require('../models/User');
const MedicalTest = require('../models/MedicalTest');
const MedicalExamRequest = require('../models/MedicalExamRequest');
const Order = require('../models/Order');
const ImageRequest = require('../models/ImageRequest');

const grouped = (Model, match, field, value = 1) => Model.aggregate([
  { $match: match }, { $group: { _id: `$${field}`, value: { $sum: value } } },
]);
const { realizedPatientOrders: realizedOrders } = require('../utils/patientOrderCommission');
const valueFor = (rows, id) => Number(rows.find(row => String(row._id) === String(id))?.value || 0);

const examTotals = (ids, field) => MedicalExamRequest.aggregate([
  { $match: { [field]: { $in: ids }, deletedAt: null, status: { $in: ['pending', 'in_progress', 'completed'] } } },
  { $group: { _id: `$${field}`, value: { $sum: 1 }, commission: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, { $sum: '$pricing.vitaCommissionAmount' }, 0] } } } },
]);
async function patientMetrics(patients) {
  if (!patients.length) return new Map();
  const ids = patients.map(patient => patient._id);
  const quoteTotals = (Model, Rx) => Model.aggregate([
    { $match: { status: 'dispensed' } },
    { $lookup: { from: Rx.collection.name, localField: 'prescription', foreignField: '_id', as: 'rx' } },
    { $unwind: '$rx' }, { $match: { 'rx.patientId': { $in: ids } } },
    { $group: { _id: '$rx.patientId', value: { $sum: '$vitaCommissionTotal' } } },
  ]);
  const [orders, appointments, exams, diagnostics, images, treatment, quotes, controlledQuotes, orderCommission] = await Promise.all([
    grouped(Order, { user: { $in: ids }, status: { $nin: ['cancelled', 'declined', 'paid'] }, adminApprovalStatus: { $ne: 'rejected' } }, 'user'),
    grouped(Appointment, { patient: { $in: ids }, status: { $in: ['pending', 'confirmed', 'completed'] } }, 'patient'),
    examTotals(ids, 'patientId'),
    LabRequest.aggregate([
      { $match: { patientId: { $in: ids }, status: { $nin: ['cancelled', 'rejected', 'declined'] }, approvalStatus: { $ne: 'rejected' } } },
      { $lookup: { from: User.collection.name, localField: 'labId', foreignField: '_id', as: 'provider' } },
      { $lookup: { from: MedicalTest.collection.name, localField: 'testIds', foreignField: '_id', as: 'tests' } },
      { $addFields: { isRadiology: { $or: [{ $in: ['Radiology', '$provider.role'] }, { $in: ['radiology', '$tests.type'] }] }, isLaboratory: { $or: [{ $in: ['Lab', '$provider.role'] }, { $in: ['laboratory', '$tests.type'] }] } } },
      { $match: { $or: [{ isRadiology: true }, { isLaboratory: true }] } },
      { $group: { _id: '$patientId', value: { $sum: { $cond: ['$isRadiology', 1, 0] } }, labCount: { $sum: { $cond: [{ $and: ['$isLaboratory', { $not: ['$isRadiology'] }] }, 1, 0] } }, commission: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$vitaCommissionAmount', 0] } } } },
    ]),
    grouped(ImageRequest, { patientId: { $in: ids }, status: { $in: ['pending', 'in_progress', 'completed'] } }, 'patientId'),
    grouped(MedicalRecord, { patient: { $in: ids }, 'billing.paidAmount': { $gt: 0 } }, 'patient', '$vitaCommissionAmount'),
    quoteTotals(Quote, Prescription), quoteTotals(ControlledQuote, Controlled),
    grouped(Order, { ...realizedOrders, user: { $in: ids } }, 'user', '$vitaCommissionAmount'),
  ]);
  return new Map(ids.map(id => {
    const diagnostic = diagnostics.find(row => String(row._id) === String(id));
    const exam = exams.find(row => String(row._id) === String(id));
    return [String(id), {
      prescriptionCount: valueFor(orders, id), appointmentCount: valueFor(appointments, id),
      labCount: valueFor(exams, id) + Number(diagnostic?.labCount || 0),
      radiologyCount: valueFor(diagnostics, id) + valueFor(images, id),
      vitaCommission: Math.round((Number(exam?.commission || 0) + Number(diagnostic?.commission || 0) + valueFor(treatment, id) + valueFor(quotes, id) + valueFor(controlledQuotes, id) + valueFor(orderCommission, id)) * 100) / 100,
    }];
  }));
}

// Aggregates only: never return patients, clinical details, prescriptions or credentials.
async function customerMetrics(customers) {
  if (!customers.length) return [];
  const doctors = customers.filter(c => c.role === 'Doctor').map(c => c._id);
  const pharmacies = customers.filter(c => c.role === 'Pharmacy').map(c => c._id);
  const patientTotalsPromise = patientMetrics(customers.filter(customer => customer.role === 'User'));
  const diagnosticsQuery = doctors.length ? LabRequest.aggregate([
    { $match: { doctorId: { $in: doctors }, status: { $ne: 'cancelled' }, approvalStatus: { $ne: 'rejected' } } },
    { $lookup: { from: User.collection.name, localField: 'labId', foreignField: '_id', as: 'provider' } },
    { $lookup: { from: MedicalTest.collection.name, localField: 'testIds', foreignField: '_id', as: 'tests' } },
    { $addFields: { isRadiology: { $or: [{ $in: ['Radiology', '$provider.role'] }, { $in: ['radiology', '$tests.type'] }] }, isLaboratory: { $or: [{ $in: ['Lab', '$provider.role'] }, { $in: ['laboratory', '$tests.type'] }] } } },
    { $match: { $or: [{ isRadiology: true }, { isLaboratory: true }] } },
    { $group: { _id: '$doctorId', value: { $sum: { $cond: ['$isRadiology', 1, 0] } }, labCount: { $sum: { $cond: [{ $and: ['$isLaboratory', { $not: ['$isRadiology'] }] }, 1, 0] } }, commission: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$vitaCommissionAmount', 0] } } } },
  ]) : Promise.resolve([]);
  const quoteDoctorTotals = (Model, Rx) => Model.aggregate([
    { $match: { status: 'dispensed' } },
    { $lookup: { from: Rx.collection.name, localField: 'prescription', foreignField: '_id', as: 'rx' } },
    { $unwind: '$rx' }, { $match: { 'rx.doctorId': { $in: doctors } } },
    { $group: { _id: '$rx.doctorId', value: { $sum: '$vitaCommissionTotal' } } },
  ]);
  const [prescriptions, controlled, appointments, medicalCommission, pharmacyCommission, controlledPharmacyCommission, doctorQuoteCommission, controlledDoctorCommission, medicalExamCounts, diagnostics, patientTotals, orderCommission] = await Promise.all([
    grouped(Prescription, { doctorId: { $in: doctors } }, 'doctorId'),
    grouped(Controlled, { doctorId: { $in: doctors }, issuedAt: { $ne: null } }, 'doctorId'),
    grouped(Appointment, { doctorId: { $in: doctors }, status: 'completed' }, 'doctorId'),
    grouped(MedicalRecord, { doctor: { $in: doctors }, 'billing.paidAmount': { $gt: 0 } }, 'doctor', '$vitaCommissionAmount'),
    grouped(Quote, { pharmacy: { $in: pharmacies }, status: 'dispensed' }, 'pharmacy', '$vitaCommissionTotal'),
    grouped(ControlledQuote, { pharmacy: { $in: pharmacies }, status: 'dispensed' }, 'pharmacy', '$vitaCommissionTotal'),
    doctors.length ? quoteDoctorTotals(Quote, Prescription) : [],
    doctors.length ? quoteDoctorTotals(ControlledQuote, Controlled) : [],
    doctors.length ? examTotals(doctors, 'doctorId') : [],
    diagnosticsQuery,
    patientTotalsPromise,
    grouped(Order, { ...realizedOrders, pharmacyId: { $in: pharmacies } }, 'pharmacyId', '$vitaCommissionAmount'),
  ]);
  return customers.map(customer => {
    if (customer.role === 'User') return { ...customer, ...patientTotals.get(String(customer._id)) };
    const id = customer._id;
    const doctor = customer.role === 'Doctor';
    const commission = doctor
      ? valueFor(medicalCommission, id) + valueFor(doctorQuoteCommission, id) + valueFor(controlledDoctorCommission, id) + Number(diagnostics.find(r => String(r._id) === String(id))?.commission || 0) + Number(medicalExamCounts.find(r => String(r._id) === String(id))?.commission || 0)
      : valueFor(pharmacyCommission, id) + valueFor(controlledPharmacyCommission, id) + valueFor(orderCommission, id);
    return { ...customer,
      prescriptionCount: doctor ? valueFor(prescriptions, id) + valueFor(controlled, id) : null,
      radiologyCount: doctor ? valueFor(diagnostics, id) : null,
      labCount: doctor ? Number(diagnostics.find(r => String(r._id) === String(id))?.labCount || 0) + valueFor(medicalExamCounts, id) : null,
      appointmentCount: doctor ? valueFor(appointments, id) : null,
      vitaCommission: Math.round(commission * 100) / 100,
    };
  });
}
// Attribute each realized transaction once per sales owner, even when both
// prescribing doctor and dispensing pharmacy belong to that owner.
async function teamCommissions(managerIds, { breakdown = false, unique = false, allTransactions = false } = {}) {
  if (!managerIds.length && !allTransactions) return new Map();
  const ownerLookup = (field, as) => ({ $lookup: { from: User.collection.name, localField: field, foreignField: '_id', as } });
  const finish = allTransactions ? [
    { $group: { _id: null, value: { $sum: '$amount' } } },
  ] : unique ? [
    { $match: { owners: { $in: managerIds } } },
    { $group: { _id: null, value: { $sum: '$amount' } } },
  ] : [
    { $unwind: '$owners' }, { $match: { owners: { $in: managerIds } } },
    { $group: { _id: '$owners', value: { $sum: '$amount' } } },
  ];
  const quoteTotals = (Model, Rx) => Model.aggregate([
    { $match: { status: 'dispensed' } },
    { $lookup: { from: Rx.collection.name, localField: 'prescription', foreignField: '_id', as: 'rx' } },
    ownerLookup('rx.doctorId', 'doctor'), ownerLookup('pharmacy', 'pharmacyOwner'), ownerLookup('rx.patientId', 'patientOwner'),
    { $project: { amount: '$vitaCommissionTotal', owners: { $setUnion: ['$doctor.salesManager', '$pharmacyOwner.salesManager', '$patientOwner.salesManager'] } } }, ...finish,
  ]);
  const results = await Promise.all([
    Order.aggregate([
      { $match: realizedOrders }, ownerLookup('pharmacyId', 'provider'), ownerLookup('user', 'patientOwner'),
      { $project: { amount: '$vitaCommissionAmount', owners: { $setUnion: ['$provider.salesManager', '$patientOwner.salesManager'] } } }, ...finish,
    ]),
    quoteTotals(Quote, Prescription), quoteTotals(ControlledQuote, Controlled),
    MedicalRecord.aggregate([{ $match: { 'billing.paidAmount': { $gt: 0 } } }, ownerLookup('doctor', 'provider'), ownerLookup('patient', 'patientOwner'), { $project: { amount: '$vitaCommissionAmount', owners: { $setUnion: ['$provider.salesManager', '$patientOwner.salesManager'] } } }, ...finish]),
    LabRequest.aggregate([
      { $match: { status: 'completed', approvalStatus: { $ne: 'rejected' } } },
      ownerLookup('doctorId', 'doctor'), ownerLookup('labId', 'provider'), ownerLookup('patientId', 'patientOwner'),
      { $lookup: { from: MedicalTest.collection.name, localField: 'testIds', foreignField: '_id', as: 'tests' } },
      { $match: { $or: [{ 'provider.role': { $in: ['Lab', 'Radiology'] } }, { 'tests.type': { $in: ['laboratory', 'radiology'] } }] } },
      { $project: { amount: '$vitaCommissionAmount', owners: { $setUnion: ['$doctor.salesManager', '$patientOwner.salesManager'] } } }, ...finish,
    ]),
    MedicalExamRequest.aggregate([
      { $match: { status: 'completed', deletedAt: null } },
      ownerLookup('doctorId', 'doctor'), ownerLookup('patientId', 'patientOwner'),
      { $project: { amount: { $sum: '$pricing.vitaCommissionAmount' }, owners: { $setUnion: ['$doctor.salesManager', '$patientOwner.salesManager'] } } }, ...finish,
    ]),
  ]);
  const totals = new Map();
  const categories = ['medicineCommission', 'medicineCommission', 'medicineCommission', 'treatmentCommission', 'diagnosticCommission', 'diagnosticCommission'];
  results.forEach((rows, index) => {
    for (const row of rows) {
      const id = String(row._id);
      const value = totals.get(id) || { medicineCommission: 0, treatmentCommission: 0, diagnosticCommission: 0, vitaCommission: 0 };
      value[categories[index]] += Number(row.value || 0);
      value.vitaCommission += Number(row.value || 0);
      totals.set(id, value);
    }
  });
  for (const [id, value] of totals) totals.set(id, breakdown
    ? Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, Math.round(amount * 100) / 100]))
    : Math.round(value.vitaCommission * 100) / 100);
  return totals;
}
async function platformCommissions() {
  const totals = await teamCommissions([], { breakdown: true, allTransactions: true });
  return { ...(totals.get('null') || { medicineCommission: 0, treatmentCommission: 0, diagnosticCommission: 0, vitaCommission: 0 }), currency: 'ILS', period: 'all_time' };
}
module.exports = { customerMetrics, teamCommissions, platformCommissions };
