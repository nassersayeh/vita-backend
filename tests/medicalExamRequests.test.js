const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const filename = require.resolve('../routes/medicalExamRequests');
const native = createRequire(filename);
const doctor = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'Doctor', patients: ['bbbbbbbbbbbbbbbbbbbbbbbb'] };
function load({ legacy = false, User = {}, Request = {}, Service = {} } = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, console, require: name => {
    if (name === '../middleware/auth') return (req, res, next) => req.user ? next() : res.status(401).json({});
    if (name === '../utils/partnerAccess') return { usesLegacyClinicDashboard: async () => legacy };
    if (name === '../models/User') return User;
    if (name === '../models/MedicalExamRequest') return Request;
    if (name === '../models/LaboratoryService') return Service;
    return native(name);
  } });
  return module.exports;
}
function request(router, method, url, user, body = {}, query = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No response')), 1500);
    const res = { statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { clearTimeout(timer); resolve({ status: this.statusCode, body }); } };
    router.handle({ method, url, originalUrl: url, headers: {}, user, body, query }, res, error => { clearTimeout(timer); reject(error || new Error('No route')); });
  });
}
test('medical exams exclude anonymous, radiology and legacy clinic accounts', async () => {
  assert.equal((await request(load(), 'POST', '/', undefined)).status, 401);
  assert.equal((await request(load(), 'POST', '/', { role: 'Radiology' })).status, 403);
  assert.equal((await request(load({ legacy: true }), 'POST', '/', doctor)).status, 403);
});
test('save without laboratory remains unsent and validates linked patient', async () => {
  let saved;
  const router = load({ User: { exists: async () => true }, Request: { create: async values => { saved = values; return values; } } });
  assert.equal((await request(router, 'POST', '/', doctor, { patientId: 'cccccccccccccccccccccccc', tests: ['CBC'] })).status, 403);
  assert.equal((await request(router, 'POST', '/', doctor, { patientId: doctor.patients[0], tests: [{}] })).status, 400);
  const result = await request(router, 'POST', '/', doctor, { patientId: doctor.patients[0], tests: ['CBC'], doctorId: 'attacker', status: 'completed' });
  assert.equal(result.status, 201);
  assert.equal(saved.doctorId, doctor._id);
  assert.equal(saved.status, 'awaiting_laboratory');
  assert.equal(saved.laboratoryId, null);
});
test('target must be an active independent Lab and queued sending is atomic and owned', async () => {
  let mutation;
  const laboratoryId = 'cccccccccccccccccccccccc';
  const router = load({ User: { findOne(filter) {
    assert.equal(filter.role, 'Lab'); assert.equal(filter.activationStatus, 'active'); assert.equal(filter.clinicId, null);
    return { select() { return this; }, lean: async () => ({ _id: laboratoryId }) };
  } }, Request: { findOneAndUpdate: async (filter, update) => { mutation = { filter, update }; return {}; } } });
  const response = await request(router, 'PATCH', '/dddddddddddddddddddddddd/send', doctor, { laboratoryId });
  assert.equal(response.status, 200);
  assert.equal(mutation.filter.doctorId, doctor._id);
  assert.equal(mutation.filter.status, 'awaiting_laboratory');
  assert.equal(mutation.update.$set.status, 'pending');
  assert.equal((await request(router, 'PATCH', '/dddddddddddddddddddddddd/complete', doctor, { results: 'forged' })).status, 403);
});
test('laboratory results update only requests assigned to authenticated laboratory', async () => {
  let filter;
  const router = load({ User: { exists: async () => true }, Request: { findOneAndUpdate: async match => { filter = match; return null; } } });
  const response = await request(router, 'PATCH', '/dddddddddddddddddddddddd/complete', { _id: 'lab-A', role: 'Lab' }, { results: 'Report' });
  assert.equal(response.status, 404);
  assert.equal(filter.laboratoryId, 'lab-A');
  assert.deepEqual(Array.from(filter.status.$in), ['pending', 'in_progress']);
});

test('catalog hides prices and templates from doctors and scopes laboratory reads', async () => {
  let selected, filter;
  const Service = { find(f) { filter = f; return { select(s) { selected = s; return this; }, sort() { return this; }, lean: async () => [] }; } };
  const User = { exists: async () => true, findOne() { return { select() { return this; }, lean: async () => ({ _id: 'cccccccccccccccccccccccc' }) }; } };
  const router = load({ User, Service });
  assert.equal((await request(router, 'GET', '/services/catalog', doctor, {}, { laboratoryId: 'cccccccccccccccccccccccc' })).status, 200);
  assert.match(selected, /-price/); assert.match(selected, /-fields/);
  await request(router, 'GET', '/services/catalog', { _id: 'dddddddddddddddddddddddd', role: 'Lab' }, {}, { laboratoryId: 'cccccccccccccccccccccccc' });
  assert.equal(filter.laboratoryId, 'dddddddddddddddddddddddd');
});
test('only laboratories may edit their own templates; invalid prices are rejected', async () => {
  let filter, update;
  const router = load({ User: { exists: async () => true }, Service: { findOneAndUpdate: async (f,u) => { filter = f; update = u; return {}; } } });
  assert.equal((await request(router, 'POST', '/services/catalog', doctor, { name: 'CBC', price: 30 })).status, 403);
  const lab = { _id: 'dddddddddddddddddddddddd', role: 'Lab' };
  assert.equal((await request(router, 'POST', '/services/catalog', lab, { name: 'CBC', price: -1 })).status, 400);
  assert.equal((await request(router, 'POST', '/services/catalog', lab, { laboratoryId: 'attacker', name: 'CBC', price: 30, fields: [{ label: 'WBC' }] })).status, 200);
  assert.equal(filter.laboratoryId, lab._id); assert.equal(update.$set.fields[0].label, 'WBC');
});
test('pricing requires every requested test and creates custom service only for owner', async () => {
  const scoped = []; let saved = false;
  const stored = { tests: ['CBC','Custom'], save: async () => { saved = true; } };
  const router = load({ User: { exists: async () => true }, Request: { findOne: async f => { assert.equal(f.laboratoryId, 'dddddddddddddddddddddddd'); return stored; }, findOneAndUpdate: async (filter,update) => { assert.equal(filter.laboratoryId,'dddddddddddddddddddddddd'); saved = true; Object.assign(stored,update.$set); return stored; } }, Service: { updateOne: async f => scoped.push(f) } });
  const lab = { _id: 'dddddddddddddddddddddddd', role: 'Lab' };
  assert.equal((await request(router, 'PATCH', '/aaaaaaaaaaaaaaaaaaaaaaaa/pricing', lab, { items: [{ name: 'CBC', price: 30 }] })).status, 400);
  assert.equal((await request(router, 'PATCH', '/aaaaaaaaaaaaaaaaaaaaaaaa/pricing', lab, { items: [{ name: 'CBC', price: 30 }, { name: 'Custom', price: 45 }] })).status, 200);
  assert.equal(stored.totalCost, 75); assert.equal(saved,true); assert.equal(scoped[1].laboratoryId,lab._id);
});

test('monthly accounts reject doctors, isolate laboratories and use complete month boundaries', async () => {
  let filter;
  const router = load({ User: { exists: async () => true }, Request: { find(f) { filter = f; return { populate() { return this; }, sort() { return this; }, lean: async () => [] }; } } });
  assert.equal((await request(router,'GET','/accounts/monthly',doctor,{}, { month: '11', year: '2026' })).status,403);
  const lab = { _id: 'dddddddddddddddddddddddd', role: 'Lab' };
  assert.equal((await request(router,'GET','/accounts/monthly',lab,{}, { month: '13', year: '2026' })).status,400);
  const result = await request(router,'GET','/accounts/monthly',lab,{}, { month: '11', year: '2026' });
  assert.equal(result.status,200); assert.equal(filter.laboratoryId, lab._id); assert.equal(filter.status,'completed');
  assert.equal(filter.$or[0].completedAt.$gte.toISOString(),'2026-10-31T21:00:00.000Z');
  assert.equal(filter.$or[0].completedAt.$lt.toISOString(),'2026-11-30T21:00:00.000Z');
  assert.equal(result.body.summary.grossIncome,0);
});
test('request details cannot be fetched for another laboratory or by a doctor', async () => {
  let filter;
  const router = load({ User: { exists: async () => true }, Request: { findOne(f) { filter = f; return { populate() { return this; }, lean: async () => null }; } } });
  const url='/aaaaaaaaaaaaaaaaaaaaaaaa/details';
  assert.equal((await request(router,'GET',url,doctor)).status,403);
  assert.equal((await request(router,'GET',url,{ _id: 'dddddddddddddddddddddddd', role: 'Lab' })).status,404);
  assert.equal(filter.laboratoryId,'dddddddddddddddddddddddd');
});
test('completed request cannot be repriced during concurrent completion', async () => {
  const lab={ _id:'dddddddddddddddddddddddd',role:'Lab' };
  const router=load({ User:{ exists:async()=>true }, Request:{ findOne:async()=>({ _id:'aaaaaaaaaaaaaaaaaaaaaaaa',tests:['CBC'],updatedAt:new Date() }), findOneAndUpdate:async filter=>{ assert.equal(filter.laboratoryId,lab._id); assert.deepEqual(Array.from(filter.status.$in),['pending','in_progress']); return null; } }, Service:{ updateOne:async()=>{} } });
  const response=await request(router,'PATCH','/aaaaaaaaaaaaaaaaaaaaaaaa/pricing',lab,{items:[{name:'CBC',price:30}]});
  assert.equal(response.status,409);
});

test('archive pagination searches all owned requests and doctor listings exclude financial fields', async () => {
  let filter, selection, skipped, limited;
  const chain={select(value){selection=value;return this;},populate(){return this;},sort(){return this;},skip(value){skipped=value;return this;},limit(value){limited=value;return this;},lean:async()=>[]};
  const router=load({User:{exists:async()=>true},Request:{find(f){filter=f;return chain;},countDocuments:async()=>42}});
  const lab={_id:'dddddddddddddddddddddddd',role:'Lab'};
  const result=await request(router,'GET','/',lab,{}, {page:'2',limit:'15',status:'completed'});
  assert.equal(result.status,200);assert.equal(filter.laboratoryId,lab._id);assert.equal(filter.status,'completed');
  assert.equal(skipped,15);assert.equal(limited,15);assert.equal(result.body.pagination.totalPages,3);
  await request(router,'GET','/',doctor);
  assert.equal(filter.doctorId,doctor._id);assert.match(selection,/-pricing/);assert.match(selection,/-totalCost/);
});
