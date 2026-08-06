/* Run on the server (or with the SSH Mongo tunnel) to create/update the IVF center accounts. */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Clinic = require('./models/Clinic');
const Employee = require('./models/Employee');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';
const PASSWORD = '123456789';
const accounts = {
  center: { fullName: 'مركز العقم وأطفال الأنابيب', mobileNumber: '0599001101', idNumber: 'FERTILITY-CENTER-1101', email: 'fertility.center@vita.ps', role: 'Clinic', internalDepartment: 'clinic', isPublic: true },
  doctor: { fullName: 'د. طبيب العقم وأطفال الأنابيب', mobileNumber: '0599001102', idNumber: 'FERTILITY-DOCTOR-1102', email: 'fertility.doctor@vita.ps', role: 'Doctor', specialty: 'Reproductive Endocrinology', isPublic: false },
  secretary: { fullName: 'سكرتاريا مركز العقم', mobileNumber: '0599001103', idNumber: 'FERTILITY-SECRETARY-1103', email: 'fertility.secretary@vita.ps', role: 'Employee', internalDepartment: 'secretariat', isPublic: false },
  lab: { fullName: 'مختبر مركز العقم', mobileNumber: '0599001104', idNumber: 'FERTILITY-LAB-1104', email: 'fertility.lab@vita.ps', role: 'Lab', internalDepartment: 'laboratory', isPublic: false },
  pharmacy: { fullName: 'صيدلية مركز العقم', mobileNumber: '0599001105', idNumber: 'FERTILITY-PHARMACY-1105', email: 'fertility.pharmacy@vita.ps', role: 'Pharmacy', internalDepartment: 'pharmacy', isPublic: false },
};

async function upsertAccount(data) {
  const password = await bcrypt.hash(PASSWORD, 10);
  return User.findOneAndUpdate(
    { mobileNumber: data.mobileNumber },
    { $set: { ...data, password, country: 'Palestine', city: 'Nablus', address: 'Nablus', activationStatus: 'active', isPaid: true, isPhoneVerified: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function run() {
  await mongoose.connect(MONGODB_URI);
  const center = await upsertAccount(accounts.center);
  const doctor = await upsertAccount({ ...accounts.doctor, managedByClinic: true });
  const secretary = await upsertAccount(accounts.secretary);
  const lab = await upsertAccount(accounts.lab);
  const pharmacy = await upsertAccount(accounts.pharmacy);

  await Employee.findOneAndUpdate(
    { employerId: center._id, userId: secretary._id },
    { employerId: center._id, userId: secretary._id, position: 'Receptionist', permissions: { canViewPatients: true, canAddPatients: true, canViewAppointments: true, canCreateAppointments: true, canEditAppointments: true, canViewFinancials: true, canManageIncome: true, canManageExpenses: true, canViewLabRequests: true, canCreateLabRequests: true }, isActive: true },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const clinic = await Clinic.findOneAndUpdate(
    { ownerId: center._id },
    { ownerId: center._id, name: center.fullName, description: 'مركز متخصص بالعقم وأطفال الأنابيب', doctors: [{ doctorId: doctor._id, status: 'active', clinicPercentage: 0 }], staff: [{ userId: secretary._id, role: 'Receptionist', status: 'active' }], settings: { enableInsurance: false } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  // Link all internal accounts to the Clinic document (not the owner User id).
  await User.updateMany({ _id: { $in: [doctor._id, secretary._id, lab._id, pharmacy._id] } }, { $set: { clinicId: clinic._id } });
  console.log(JSON.stringify({ password: PASSWORD, center: center.mobileNumber, doctor: doctor.mobileNumber, secretary: secretary.mobileNumber, lab: lab.mobileNumber, pharmacy: pharmacy.mobileNumber }, null, 2));
  await mongoose.disconnect();
}

run().catch(async error => { console.error(error); await mongoose.disconnect(); process.exitCode = 1; });
