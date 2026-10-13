const Prescription = require('../models/EPrescription');
const Controlled = require('../models/ControlledPrescription');
const Appointment = require('../models/Appointment');
const LabRequest = require('../models/LabRequest');
const MedicalRecord = require('../models/MedicalRecord');
const Quote = require('../models/PharmacyPrescriptionQuote');
const ControlledQuote = require('../models/ControlledQuote');
const User = require('../models/User');
const MedicalTest = require('../models/MedicalTest');

const grouped = (Model, match, field, value = 1) => Model.aggregate([
  { $match: match }, { $group: { _id: `$${field}`, value: { $sum: value } } },
]);
const valueFor = (rows, id) => Number(rows.find(row => String(row._id) === String(id))?.value || 0);

// Aggregates only: never return patients, clinical details, prescriptions or credentials.
async function customerMetrics(customers) {
  if (!customers.length) return [];
  const doctors = customers.filter(c => c.role === 'Doctor').map(c => c._id);
  const pharmacies = customers.filter(c => c.role === 'Pharmacy').map(c => c._id);
  const radiology = await LabRequest.aggregate([
    { $match: { doctorId: { $in: doctors }, status: { $ne: 'cancelled' }, approvalStatus: { $ne: 'rejected' } } },
    { $lookup: { from: User.collection.name, localField: 'labId', foreignField: '_id', as: 'provider' } },
    { $lookup: { from: MedicalTest.collection.name, localField: 'testIds', foreignField: '_id', as: 'tests' } },
    { $match: { $or: [{ 'provider.role': 'Radiology' }, { 'tests.type': 'radiology' }] } },
    { $group: { _id: '$doctorId', value: { $sum: 1 }, commission: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$vitaCommissionAmount', 0] } } } },
  ]);
  const quoteDoctorTotals = (Model, Rx) => Model.aggregate([
    { $match: { status: 'dispensed' } },
    { $lookup: { from: Rx.collection.name, localField: 'prescription', foreignField: '_id', as: 'rx' } },
    { $unwind: '$rx' }, { $match: { 'rx.doctorId': { $in: doctors } } },
    { $group: { _id: '$rx.doctorId', value: { $sum: '$vitaCommissionTotal' } } },
  ]);
  const [prescriptions, controlled, appointments, medicalCommission, pharmacyCommission, controlledPharmacyCommission, doctorQuoteCommission, controlledDoctorCommission] = await Promise.all([
    grouped(Prescription, { doctorId: { $in: doctors } }, 'doctorId'),
    grouped(Controlled, { doctorId: { $in: doctors }, issuedAt: { $ne: null } }, 'doctorId'),
    grouped(Appointment, { doctorId: { $in: doctors }, status: 'completed' }, 'doctorId'),
    grouped(MedicalRecord, { doctor: { $in: doctors }, 'billing.paidAmount': { $gt: 0 } }, 'doctor', '$vitaCommissionAmount'),
    grouped(Quote, { pharmacy: { $in: pharmacies }, status: 'dispensed' }, 'pharmacy', '$vitaCommissionTotal'),
    grouped(ControlledQuote, { pharmacy: { $in: pharmacies }, status: 'dispensed' }, 'pharmacy', '$vitaCommissionTotal'),
    doctors.length ? quoteDoctorTotals(Quote, Prescription) : [],
    doctors.length ? quoteDoctorTotals(ControlledQuote, Controlled) : [],
  ]);
  return customers.map(customer => {
    const id = customer._id;
    const doctor = customer.role === 'Doctor';
    const commission = doctor
      ? valueFor(medicalCommission, id) + valueFor(doctorQuoteCommission, id) + valueFor(controlledDoctorCommission, id) + Number(radiology.find(r => String(r._id) === String(id))?.commission || 0)
      : valueFor(pharmacyCommission, id) + valueFor(controlledPharmacyCommission, id);
    return { ...customer,
      prescriptionCount: doctor ? valueFor(prescriptions, id) + valueFor(controlled, id) : null,
      radiologyCount: doctor ? valueFor(radiology, id) : null,
      appointmentCount: doctor ? valueFor(appointments, id) : null,
      vitaCommission: Math.round(commission * 100) / 100,
    };
  });
}
module.exports = { customerMetrics };
