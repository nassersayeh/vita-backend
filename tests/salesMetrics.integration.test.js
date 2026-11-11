const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
test('sales patient and provider metrics preserve activity scopes and deduplicate recorded commissions per owner', { skip: process.env.RUN_SALES_INTEGRATION !== '1' }, async () => {
  require('dotenv').config({ quiet: true });
  const connection = await mongoose.createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false }).asPromise();
  const prefix = `vita_sales_test_${randomUUID().replaceAll('-', '')}_`;
  const models = {};
  try {
    for (const name of ['User', 'MedicalTest', 'EPrescription', 'ControlledPrescription', 'Appointment', 'LabRequest', 'MedicalRecord', 'PharmacyPrescriptionQuote', 'ControlledQuote', 'MedicalExamRequest', 'Order', 'ImageRequest']) {
      models[name] = connection.model(prefix + name, new mongoose.Schema({}, { strict: false }), prefix + name);
    }
    const id = () => new mongoose.Types.ObjectId();
    const manager = id(), secondManager = id();
    const doctor = id(), pharmacy = id(), outsider = id(), radiology = id(), lab = id(), prescription = id(), controlled = id();
    await models.User.insertMany([{ _id: doctor, role: 'Doctor', salesManager: manager }, { _id: pharmacy, role: 'Pharmacy', salesManager: manager }, { _id: radiology, role: 'Radiology' }, { _id: lab, role: 'Lab' }]);
    await models.EPrescription.insertMany([{ _id: prescription, doctorId: doctor }, { doctorId: outsider }]);
    await models.ControlledPrescription.insertMany([{ _id: controlled, doctorId: doctor, issuedAt: new Date() }, { doctorId: doctor }, { doctorId: doctor, issuedAt: null }]);
    await models.MedicalExamRequest.insertMany([{ doctorId: doctor, status: 'awaiting_laboratory' }, { doctorId: doctor, status: 'pending' }, { doctorId: doctor, status: 'completed' }]);
    await models.Appointment.insertMany(['completed', 'pending', 'cancelled'].map(status => ({ doctorId: doctor, status })));
    await models.LabRequest.insertMany([
      { doctorId: doctor, labId: radiology, status: 'completed', vitaCommissionAmount: 5 },
      { doctorId: doctor, labId: radiology, status: 'pending', vitaCommissionAmount: 80 },
      { doctorId: doctor, labId: radiology, status: 'cancelled', vitaCommissionAmount: 80 },
      { doctorId: doctor, labId: lab, status: 'completed', vitaCommissionAmount: 90 },
    ]);
    await models.MedicalRecord.insertMany([{ doctor, billing: { paidAmount: 100 }, vitaCommissionAmount: 5 }, { doctor, billing: { paidAmount: 0 }, vitaCommissionAmount: 100 }]);
    await models.PharmacyPrescriptionQuote.insertMany([{ prescription, pharmacy, status: 'dispensed', vitaCommissionTotal: 2 }, { prescription, pharmacy, status: 'priced', vitaCommissionTotal: 50 }]);
    await models.ControlledQuote.insertMany([{ prescription: controlled, pharmacy, status: 'dispensed', vitaCommissionTotal: 3 }]);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../services/salesMetrics'), 'utf8'), { module, require: name => name === '../utils/patientOrderCommission' ? require(name) : models[name.split('/').pop()] });
    const rows = await module.exports.customerMetrics([{ _id: doctor, role: 'Doctor' }, { _id: pharmacy, role: 'Pharmacy' }]);
    assert.equal(rows[0].prescriptionCount, 2);
    assert.equal(rows[0].radiologyCount, 2);
    assert.equal(rows[0].appointmentCount, 1);
    assert.equal(rows[0].labCount, 3, 'sent medical exams count; unsent requests do not');
    assert.equal(rows[0].vitaCommission, 105);
    assert.equal(rows[1].vitaCommission, 5);
    assert.equal(rows[1].prescriptionCount, null);
    const commissions = await module.exports.teamCommissions([manager, secondManager]);
    assert.equal(commissions.get(String(manager)), 105, 'same pharmacy and doctor owner is credited only once');
    await models.User.updateOne({ _id: pharmacy }, { $set: { salesManager: secondManager } });
    const separate = await module.exports.teamCommissions([manager, secondManager]);
    assert.equal(separate.get(String(manager)), 105);
    assert.equal(separate.get(String(secondManager)), 5);

    const patient = id();
    await models.User.insertMany([{ _id: patient, role: 'User', salesManager: manager }]);
    await models.User.updateOne({ _id: pharmacy }, { $set: { salesManager: manager } });
    await models.EPrescription.updateOne({ _id: prescription }, { $set: { patientId: patient } });
    await models.ControlledPrescription.updateOne({ _id: controlled }, { $set: { patientId: patient } });
    await models.LabRequest.updateMany({ doctorId: doctor }, { $set: { patientId: patient } });
    await models.MedicalRecord.updateMany({ doctor }, { $set: { patient } });
    await models.MedicalExamRequest.updateMany({ doctorId: doctor }, { $set: { patientId: patient } });
    await models.MedicalExamRequest.updateOne({ doctorId: doctor, status: 'completed' }, { $set: { pricing: [{ vitaCommissionAmount: 2 }] } });
    await models.MedicalExamRequest.insertMany([
      { patientId: patient, source: 'patient', status: 'in_progress' },
      { patientId: patient, source: 'patient', status: 'completed', pricing: [{ vitaCommissionAmount: 3 }] },
      { patientId: patient, status: 'completed', deletedAt: new Date(), pricing: [{ vitaCommissionAmount: 100 }] },
    ]);
    await models.Order.insertMany([
      { user: patient, status: 'pending', adminApprovalStatus: 'pending' },
      { user: patient, status: 'completed', adminApprovalStatus: 'approved' },
      { user: patient, status: 'cancelled' }, { user: patient, status: 'pending', adminApprovalStatus: 'rejected' },
      { user: outsider, status: 'completed' },
    ]);
    await models.Appointment.insertMany(['pending', 'confirmed', 'completed', 'cancelled'].map(status => ({ patient, status })));
    await models.ImageRequest.insertMany([{ patientId: patient, status: 'pending' }, { patientId: patient, status: 'cancelled' }]);
    const [patientRow] = await module.exports.customerMetrics([{ _id: patient, role: 'User', fullName: 'Patient' }]);
    assert.equal(patientRow.prescriptionCount, 2);
    assert.equal(patientRow.appointmentCount, 3);
    assert.equal(patientRow.labCount, 5);
    assert.equal(patientRow.radiologyCount, 3);
    assert.equal(patientRow.vitaCommission, 110);
    assert.deepEqual(Object.keys(patientRow).sort(), ['_id', 'role', 'fullName', 'prescriptionCount', 'appointmentCount', 'labCount', 'radiologyCount', 'vitaCommission'].sort());
    const combined = await module.exports.teamCommissions([manager, secondManager]);
    assert.equal(combined.get(String(manager)), 110, 'patient, doctor and pharmacy share one owner; credit each recorded commission once');
    await models.User.updateOne({ _id: patient }, { $set: { salesManager: secondManager } });
    const patientOtherOwner = await module.exports.teamCommissions([manager, secondManager]);
    assert.equal(patientOtherOwner.get(String(manager)), 107);
    assert.equal(patientOtherOwner.get(String(secondManager)), 110);

  } finally {
    for (const model of Object.values(models)) await model.collection.drop().catch(error => { if (error.code !== 26) throw error; });
    await connection.close();
  }
});
