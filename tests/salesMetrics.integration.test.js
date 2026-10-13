const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
test('sales totals exclude unused tickets, pending appointments and undispensed quotes', { skip: process.env.RUN_SALES_INTEGRATION !== '1' }, async () => {
  require('dotenv').config({ quiet: true });
  const connection = await mongoose.createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false }).asPromise();
  const prefix = `vita_sales_test_${randomUUID().replaceAll('-', '')}_`;
  const models = {};
  try {
    for (const name of ['User', 'MedicalTest', 'EPrescription', 'ControlledPrescription', 'Appointment', 'LabRequest', 'MedicalRecord', 'PharmacyPrescriptionQuote', 'ControlledQuote']) {
      models[name] = connection.model(prefix + name, new mongoose.Schema({}, { strict: false }), prefix + name);
    }
    const id = () => new mongoose.Types.ObjectId();
    const doctor = id(), pharmacy = id(), outsider = id(), radiology = id(), lab = id(), prescription = id(), controlled = id();
    await models.User.insertMany([{ _id: radiology, role: 'Radiology' }, { _id: lab, role: 'Lab' }]);
    await models.EPrescription.insertMany([{ _id: prescription, doctorId: doctor }, { doctorId: outsider }]);
    await models.ControlledPrescription.insertMany([{ _id: controlled, doctorId: doctor, issuedAt: new Date() }, { doctorId: doctor }, { doctorId: doctor, issuedAt: null }]);
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
    vm.runInNewContext(fs.readFileSync(require.resolve('../services/salesMetrics'), 'utf8'), { module, require: name => models[name.split('/').pop()] });
    const rows = await module.exports.customerMetrics([{ _id: doctor, role: 'Doctor' }, { _id: pharmacy, role: 'Pharmacy' }]);
    assert.equal(rows[0].prescriptionCount, 2);
    assert.equal(rows[0].radiologyCount, 2);
    assert.equal(rows[0].appointmentCount, 1);
    assert.equal(rows[0].vitaCommission, 15);
    assert.equal(rows[1].vitaCommission, 5);
    assert.equal(rows[1].prescriptionCount, null);
  } finally {
    for (const model of Object.values(models)) await model.collection.drop().catch(error => { if (error.code !== 26) throw error; });
    await connection.close();
  }
});
