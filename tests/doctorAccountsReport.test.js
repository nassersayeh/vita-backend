const { test } = require('node:test');
const assert = require('node:assert/strict');
const report = require('../utils/doctorAccountsReport');
test('financial report separates cash, outstanding debt, expenses and confirmed-source commissions without counting appointment income twice', () => {
 const result = report([{ transactions: [{ amount: 100 }, { amount: 50 }], expenses: [{ amount: 20, description: 'ايجار' }], debts: [{ patientId: 'a', amount: 30, originalAmount: 50, status: 'pending' }, { debtorType: 'insurance', amount: 40, status: 'pending' }, { patientId: 'a', amount: 0, originalAmount: 10, status: 'paid' }] }], [
  { bookingSource: 'vita', status: 'completed', isPaid: true, paymentAmount: 100 },
  { bookingSource: 'vita', status: 'cancelled', isPaid: true, paymentAmount: 100 },
  { bookingSource: 'vita', status: 'completed', isPaid: true, autoMarkedAsPaid: true, paymentAmount: 100 },
  { bookingSource: 'manual', status: 'completed', isPaid: true, paymentAmount: 100 },
  { status: 'completed', isPaid: true, paymentAmount: 100 },
 ], [{ vitaCommissionAmount: 3 }]);
 assert.equal(result.summary.income, 150);
 assert.equal(result.summary.cashNet, 130);
 assert.equal(result.summary.patientDebt, 30);
 assert.equal(result.summary.insuranceDebt, 40);
 assert.equal(result.summary.debtCreated, 100);
 assert.equal(result.summary.indebtedPatients, 1);
 assert.equal(result.summary.appointmentCommission, 5);
 assert.equal(result.summary.recordedTreatmentCommission, 3);
 assert.equal(result.summary.vitaAppointmentCount, 3);
 assert.equal(result.summary.unknownSourceCount, 1);
 assert.equal(result.summary.eligibleAppointmentCount, 1);
 assert.equal(result.history.length, 6);
});
test('empty accounts return zero totals', () => {
 const result = report([], [], []);
 assert.equal(result.summary.income, 0);
 assert.equal(result.summary.appointmentCommission, 0);
 assert.equal(result.history.length, 0);
});
