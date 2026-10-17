const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const id = '111111111111111111111111';
function setup(appointment) {
 const file = require.resolve('../controllers/partnerAppointmentsController'); const native = createRequire(file); const module = { exports: {} }; const writes = [], notifications = [], filters = [];
 const models = {
  '../models/Appointment': { create: async data => { writes.push({ created: data }); return { _id: id, ...data }; }, findOne: async filter => { filters.push(filter); return appointment; }, findOneAndUpdate: (filter, update) => { writes.push({filter, update}); return { populate: async () => ({ ...appointment, ...update.$set }) }; } },
  '../models/User': { exists: async () => true, updateOne: async () => ({modifiedCount: 1}) },
  '../models/Notification': { create: async payload => { notifications.push(payload); } },
  './appointmentController': { getAvailableTimeSlots: async (req, res) => res.json({ timeSlots: [{start: '10:00'}] }) },
 };
 vm.runInNewContext(fs.readFileSync(file, 'utf8'), {module, exports: module.exports, require: name => models[name] || native(name)});
 return { writes, filters, notifications, async send(body, method = 'update') { let result; const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) {result = {status: this.statusCode, data};} }; await module.exports[method]({ user: {_id: 'doctor', fullName:'Doctor', patients:[id], workplaces:[{name:'Clinic', isActive:true}]}, params:{id}, body }, res); return result; } };
}
const appointment = { _id:id, patient:'patient', status:'pending', appointmentDateTime: new Date('2099-01-01T09:00:00'), workplaceName:'Clinic', durationMinutes:30 };
test('lookup is scoped to authenticated independent doctor and missing/foreign appointment cannot be changed', async () => {
 const app = setup(null); assert.equal((await app.send({action:'accept'})).status,404); assert.equal(app.filters[0].doctorId,'doctor'); assert.equal(app.filters[0].clinicId,null); assert.equal(app.writes.length,0);
});
test('accept updates pending status and notifies patient; completed appointments cannot be changed', async () => {
 const app=setup(appointment); assert.equal((await app.send({action:'accept'})).status,200); assert.equal(app.writes[0].update.$set.status,'confirmed'); assert.equal(app.writes[0].filter.status,'pending'); assert.equal(app.notifications[0].user,'patient');
 assert.equal((await setup({...appointment,status:'completed'}).send({action:'cancel',reason:'Reason'})).status,409);
});
test('cancellation requires reason, persists it and sends it to patient without rewriting payment data', async () => {
 const app=setup(appointment); assert.equal((await app.send({action:'cancel',reason:' '})).status,400); assert.equal(app.writes.length,0);
 assert.equal((await app.send({action:'cancel',reason:'Doctor unavailable'})).status,200);
 assert.equal(app.writes[0].update.$set.cancellationReason,'Doctor unavailable'); assert.equal(app.writes[0].update.$set.paymentAmount,undefined); assert.match(app.notifications[0].message,/Doctor unavailable/);
});
test('reschedule rechecks availability and rejects unavailable slots', async () => {
 const app=setup({...appointment,status:'confirmed'});
 assert.equal((await app.send({action:'reschedule',date:'2099-01-02',time:'12:00'})).status,409); assert.equal(app.writes.length,0);
 assert.equal((await app.send({action:'reschedule',date:'2099-01-02',time:'10:00'})).status,200); assert.equal(app.writes[0].update.$set.reminderDaySent,false);
});

test('manual booking requires linked patient and available time, and ignores forged doctor/source/status', async () => {
 const app = setup(null);
 const body = { patientId: id, workplaceName: 'Clinic', date: '2099-01-02', time: '10:00', reason: 'Follow up', bookingSource: 'vita', doctorId: 'foreign', status: 'completed' };
 assert.equal((await app.send({...body, patientId:'222222222222222222222222'}, 'create')).status,403);
 assert.equal((await app.send({...body, time:'12:00'}, 'create')).status,409);
 assert.equal((await app.send({...body, reason:''}, 'create')).status,400);
 assert.equal(app.writes.length,0);
 assert.equal((await app.send(body, 'create')).status,201);
 assert.equal(app.writes[0].created.doctorId,'doctor');
 assert.equal(app.writes[0].created.bookingSource,'manual');
 assert.equal(app.writes[0].created.status,'confirmed');
 assert.equal(app.writes[0].created.patient,id);
 assert.equal(app.notifications[0].user,id);
});
