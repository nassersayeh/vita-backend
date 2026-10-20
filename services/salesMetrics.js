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

const grouped = (Model, match, field, value = 1) => Model.aggregate([
  { $match: match }, { $group: { _id: `$${field}`, value: { $sum: value } } },
]);
const valueFor = (rows, id) => Number(rows.find(row => String(row._id) === String(id))?.value || 0);

// Aggregates only: never return patients, clinical details, prescriptions or credentials.
async function customerMetrics(customers) {
  if (!customers.length) return [];
  const doctors = customers.filter(c => c.role === 'Doctor').map(c => c._id);
  const pharmacies = customers.filter(c => c.role === 'Pharmacy').map(c => c._id);
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
  const [prescriptions, controlled, appointments, medicalCommission, pharmacyCommission, controlledPharmacyCommission, doctorQuoteCommission, controlledDoctorCommission, medicalExamCounts, diagnostics] = await Promise.all([
    grouped(Prescription, { doctorId: { $in: doctors } }, 'doctorId'),
    grouped(Controlled, { doctorId: { $in: doctors }, issuedAt: { $ne: null } }, 'doctorId'),
    grouped(Appointment, { doctorId: { $in: doctors }, status: 'completed' }, 'doctorId'),
    grouped(MedicalRecord, { doctor: { $in: doctors }, 'billing.paidAmount': { $gt: 0 } }, 'doctor', '$vitaCommissionAmount'),
    grouped(Quote, { pharmacy: { $in: pharmacies }, status: 'dispensed' }, 'pharmacy', '$vitaCommissionTotal'),
    grouped(ControlledQuote, { pharmacy: { $in: pharmacies }, status: 'dispensed' }, 'pharmacy', '$vitaCommissionTotal'),
    doctors.length ? quoteDoctorTotals(Quote, Prescription) : [],
    doctors.length ? quoteDoctorTotals(ControlledQuote, Controlled) : [],
    grouped(MedicalExamRequest, { doctorId: { $in: doctors }, status: { $in: ['pending', 'completed'] } }, 'doctorId'),
    diagnosticsQuery,
  ]);
  return customers.map(customer => {
    const id = customer._id;
    const doctor = customer.role === 'Doctor';
    const commission = doctor
      ? valueFor(medicalCommission, id) + valueFor(doctorQuoteCommission, id) + valueFor(controlledDoctorCommission, id) + Number(diagnostics.find(r => String(r._id) === String(id))?.commission || 0)
      : valueFor(pharmacyCommission, id) + valueFor(controlledPharmacyCommission, id);
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
async function teamCommissions(managerIds) {
  if (!managerIds.length) return new Map();
  const ownerLookup = (field, as) => ({ $lookup: { from: User.collection.name, localField: field, foreignField: '_id', as } });
  const finish = [
    { $unwind: '$owners' }, { $match: { owners: { $in: managerIds } } },
    { $group: { _id: '$owners', value: { $sum: '$amount' } } },
  ];
  const quoteTotals = (Model, Rx) => Model.aggregate([
    { $match: { status: 'dispensed' } },
    { $lookup: { from: Rx.collection.name, localField: 'prescription', foreignField: '_id', as: 'rx' } },
    ownerLookup('rx.doctorId', 'doctor'), ownerLookup('pharmacy', 'pharmacyOwner'),
    { $project: { amount: '$vitaCommissionTotal', owners: { $setUnion: ['$doctor.salesManager', '$pharmacyOwner.salesManager'] } } }, ...finish,
  ]);
  const results = await Promise.all([
    quoteTotals(Quote, Prescription), quoteTotals(ControlledQuote, Controlled),
    MedicalRecord.aggregate([{ $match: { 'billing.paidAmount': { $gt: 0 } } }, ownerLookup('doctor', 'provider'), { $project: { amount: '$vitaCommissionAmount', owners: '$provider.salesManager' } }, ...finish]),
    LabRequest.aggregate([
      { $match: { status: 'completed', approvalStatus: { $ne: 'rejected' } } },
      ownerLookup('doctorId', 'doctor'), ownerLookup('labId', 'provider'),
      { $lookup: { from: MedicalTest.collection.name, localField: 'testIds', foreignField: '_id', as: 'tests' } },
      { $match: { $or: [{ 'provider.role': { $in: ['Lab', 'Radiology'] } }, { 'tests.type': { $in: ['laboratory', 'radiology'] } }] } },
      { $project: { amount: '$vitaCommissionAmount', owners: '$doctor.salesManager' } }, ...finish,
    ]),
  ]);
  const totals = new Map();
  for (const row of results.flat()) totals.set(String(row._id), (totals.get(String(row._id)) || 0) + Number(row.value || 0));
  for (const [id, value] of totals) totals.set(id, Math.round(value * 100) / 100);
  return totals;
}
module.exports = { customerMetrics, teamCommissions };
