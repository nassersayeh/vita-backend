const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const filename = require.resolve('../routes/medicalExamRequests');
const native = createRequire(filename);
const doctor = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'Doctor', patients: ['bbbbbbbbbbbbbbbbbbbbbbbb'] };
const patient = { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', role: 'User' };
function load({ legacy = false, User = {}, Request = {}, Service = {}, WhatsApp = { isWhatsAppReady: async () => false } } = {}) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, console, require: name => {
    if (name === '../middleware/auth') return (req, res, next) => req.user ? next() : res.status(401).json({});
    if (name === '../utils/partnerAccess') return { usesLegacyClinicDashboard: async () => legacy };
    if (name === '../models/User') return User;
    if (name === '../models/MedicalExamRequest') return Request;
    if (name === '../models/LaboratoryService') return Service;
    if (name === '../services/whatsappService') return WhatsApp;
    return native(name);
  } });
  return module.exports;
}
function request(router, method, url, user, body = {}, query = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No response')), 1500);
    const res = { statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { clearTimeout(timer); resolve({ status: this.statusCode, body }); } };
    router.handle({ method, url, path: url.split('?')[0], originalUrl: url, headers: {}, user, body, query }, res, error => { clearTimeout(timer); reject(error || new Error('No route')); });
  });
}

test('laboratory WhatsApp uses the saved recipient after patient, doctor and queued requests are sent', async () => {
  const labId = 'cccccccccccccccccccccccc', serviceId = 'dddddddddddddddddddddddd';
  for (const flow of ['patient', 'doctor', 'queued']) {
    let saved = false, sends = 0;
    const stored = { _id: 'eeeeeeeeeeeeeeeeeeeeeeee', patientId: patient._id, laboratoryId: labId, tests: ['CBC'], status: 'pending' };
    const router = load({ User: {
      exists: async () => true,
      findOne: () => ({ select() { return this; }, lean: async () => ({ _id: labId, fullName: 'Lab', mobileNumber: '0598809429' }) }),
      findById: () => ({ select() { return this; }, lean: async () => ({ fullName: 'Patient' }) }),
    }, Service: { find: () => ({ select() { return this; }, lean: async () => [{ _id: serviceId, name: 'CBC', price: 20 }] }) },
    Request: {
      create: async values => { saved = true; return { ...stored, ...values }; },
      findOneAndUpdate: async () => { if (saved) return null; saved = true; return stored; },
    }, WhatsApp: {
      isWhatsAppReady: async () => true,
      sendWhatsAppMessage: async (phone, message) => {
        assert.equal(saved, true); assert.equal(phone, '0598809429');
        assert.match(message, /CBC/); assert.match(message, /https:\/\/www.vita.ps\/login/);
        assert.match(message, /eeeeeeeeeeeeeeeeeeeeeeee/);
        assert.ok(message.includes(flow === 'patient' ? 'Patient' : 'Doctor'));
        sends++;
      },
    } });
    const url = flow === 'patient' ? '/patient' : flow === 'doctor' ? '/' : `/${stored._id}/send`;
    const method = flow === 'queued' ? 'PATCH' : 'POST';
    const sender = flow === 'patient' ? { ...patient, fullName: 'Patient' } : { ...doctor, fullName: 'Doctor' };
    const response = await request(router, method, url, sender, { laboratoryId: labId, patientId: patient._id, serviceIds: [serviceId], tests: ['CBC'], mobileNumber: 'attacker' });
    assert.equal(response.status, flow === 'queued' ? 200 : 201); assert.equal(sends, 1);
    if (flow === 'queued') {
      assert.equal((await request(router, method, url, sender, { laboratoryId: labId })).status, 409);
      assert.equal(sends, 1);
    }
  }
});

test('WhatsApp unavailable, absent phone or send failure never loses a saved request; drafts do not notify', async () => {
  const labId = 'cccccccccccccccccccccccc';
  for (const scenario of ['offline', 'no-phone', 'send-error', 'draft']) {
    let saved = false, sends = 0;
    const router = load({ User: {
      exists: async () => true,
      findOne: () => ({ select() { return this; }, lean: async () => ({ _id: labId, mobileNumber: scenario === 'no-phone' ? '' : '0598809429' }) }),
      findById: () => ({ select() { return this; }, lean: async () => ({ fullName: 'Patient' }) }),
    }, Request: { create: async values => { saved = true; return { ...values, _id: 'eeeeeeeeeeeeeeeeeeeeeeee' }; } }, WhatsApp: {
      isWhatsAppReady: async () => scenario !== 'offline',
      sendWhatsAppMessage: async () => { sends++; throw new Error('Simulated WhatsApp failure'); },
    } });
    const response = await request(router, 'POST', '/', doctor, { patientId: patient._id, tests: ['CBC'], ...(scenario === 'draft' ? {} : { laboratoryId: labId }) });
    assert.equal(response.status, 201); assert.equal(saved, true);
    assert.equal(sends, scenario === 'send-error' ? 1 : 0);
  }
});

test('patient request uses authenticated identity and laboratory catalog prices and reaches the laboratory inbox', async () => {
  const labId = 'cccccccccccccccccccccccc';
  const serviceId = 'dddddddddddddddddddddddd';
  let stored, serviceFilter, inboxFilter;
  const User = { exists: async () => true, findOne: () => ({ select() { return this; }, lean: async () => ({ _id: labId }) }) };
  const chain = { select() { return this; }, populate() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => [stored] };
  const router = load({ User, Service: { find(filter) { serviceFilter = filter; return { select() { return this; }, lean: async () => [{ _id: serviceId, name: 'CBC', price: 20 }] }; } }, Request: {
    create: async values => { stored = { ...values, _id: 'eeeeeeeeeeeeeeeeeeeeeeee' }; return stored; },
    find: filter => { inboxFilter = filter; return chain; },
  } });
  const response = await request(router, 'POST', '/patient', patient, { laboratoryId: labId, serviceIds: [serviceId], patientId: doctor._id, doctorId: doctor._id, price: 0, totalCost: 0, source: 'doctor', notes: ' note ' });
  assert.equal(response.status, 201);
  assert.equal(stored.patientId, patient._id); assert.equal(stored.doctorId, undefined);
  assert.equal(stored.source, 'patient'); assert.equal(stored.status, 'pending');
  assert.equal(stored.totalCost, 20); assert.equal(stored.pricing[0].price, 20);
  assert.equal(stored.notes, 'note');
  assert.equal(serviceFilter.laboratoryId, labId); assert.equal(serviceFilter.isActive, true);
  assert.equal(response.body.request.pricing, undefined);
  const inbox = await request(router, 'GET', '/', { _id: labId, role: 'Lab' });
  assert.equal(inbox.status, 200); assert.equal(inboxFilter.laboratoryId, labId);
  assert.equal(inbox.body.requests[0].source, 'patient');
  assert.equal(inbox.body.requests[0].accounting.totalCost, 20);
});

test('patient cannot submit missing, duplicate, excessive or unavailable laboratory tests', async () => {
  const laboratoryId = 'cccccccccccccccccccccccc', serviceId = 'dddddddddddddddddddddddd';
  let creates = 0, available = true;
  const router = load({ User: { findOne: () => ({ select() { return this; }, lean: async () => available ? { _id: laboratoryId } : null }) },
    Service: { find: () => ({ select() { return this; }, lean: async () => [] }) },
    Request: { create: async () => { creates++; } },
  });
  for (const serviceIds of [[], [serviceId, serviceId], ['invalid'], Array(31).fill(serviceId), [serviceId]]) {
    assert.equal((await request(router, 'POST', '/patient', patient, { laboratoryId, serviceIds })).status, 400);
  }
  available = false;
  assert.equal((await request(router, 'POST', '/patient', patient, { laboratoryId, serviceIds: [serviceId] })).status, 400);
  assert.equal(creates, 0);
  assert.equal((await request(router, 'POST', '/patient', doctor, { laboratoryId, serviceIds: [serviceId] })).status, 403);
});

test('patient history cannot be redirected to another patient and patient mutations are blocked', async () => {
  let filter, selection;
  const chain = { select(value) { selection = value; return this; }, populate() { return this; }, sort() { return this; }, limit() { return this; }, skip() { return this; }, lean: async () => [] };
  const router = load({ Request: { find: value => { filter = value; return chain; }, countDocuments: async () => 0 } });
  assert.equal((await request(router, 'GET', '/', patient, {}, { page: '1' })).status, 200);
  assert.equal(filter.patientId, patient._id); assert.equal(filter.deletedAt, null);
  assert.match(selection, /-pricing/); assert.match(selection, /-resultDraft/);
  assert.equal((await request(router, 'GET', '/', patient, {}, { patientId: doctor._id })).status, 403);
  for (const [method, url] of [['POST', '/'], ['POST', '/services/catalog'], ['PATCH', '/aaaaaaaaaaaaaaaaaaaaaaaa/pricing'], ['PATCH', '/aaaaaaaaaaaaaaaaaaaaaaaa/complete'], ['DELETE', '/aaaaaaaaaaaaaaaaaaaaaaaa'], ['GET', '/dashboard/stats'], ['GET', '/aaaaaaaaaaaaaaaaaaaaaaaa/details']]) {
    assert.equal((await request(router, method, url, patient)).status, 403);
  }
});

test('patient catalog exposes only public test fields and validates the laboratory', async () => {
  let selected, filter;
  const laboratoryId = 'cccccccccccccccccccccccc';
  const router = load({ User: { findOne: () => ({ select() { return this; }, lean: async () => ({ _id: laboratoryId }) }) }, Service: {
    find: value => { filter = value; return { select(value) { selected = value; return this; }, sort() { return this; }, lean: async () => [] }; },
  } });
  const result = await request(router, 'GET', '/services/catalog', patient, {}, { laboratoryId });
  assert.equal(result.status, 200); assert.equal(filter.laboratoryId, laboratoryId);
  assert.equal(selected, '_id name price category');
  assert.equal((await request(router, 'GET', '/services/catalog', patient, {}, {})).status, 400);
});

test('patient-created request validates without a doctor while doctor requests still require one', async () => {
  const Model = native('../models/MedicalExamRequest');
  const values = { patientId: patient._id, laboratoryId: 'cccccccccccccccccccccccc', tests: ['CBC'], status: 'pending' };
  assert.equal(new Model({ ...values, source: 'patient' }).validateSync(), undefined);
  assert.ok(new Model(values).validateSync().errors.doctorId);
});
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

test('catalog pages stay scoped and clamp to the last page without loading the full catalog', async () => {
  const lab = { _id: 'dddddddddddddddddddddddd', role: 'Lab' };
  let offset, limit, counted, filter;
  const router = load({ User: { exists: async () => true }, Service: {
    countDocuments: async f => { counted = f; return 128; },
    find(f) { filter = f; return {
      select() { return this; }, sort() { return this; },
      skip(n) { offset = n; return this; }, limit(n) { limit = n; return this; },
      lean: async () => [],
    }; },
  } });
  const result = await request(router, 'GET', '/services/catalog', lab, {}, { page: '2', limit: '15', laboratoryId: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
  assert.equal(result.status, 200);
  assert.equal(filter.laboratoryId, lab._id);
  assert.equal(counted.laboratoryId, lab._id);
  assert.equal(filter.isActive, true);
  assert.equal(offset, 15); assert.equal(limit, 15);
  assert.equal(result.body.pagination.totalPages, 9);
  assert.equal(result.body.pagination.total, 128);
  const last = await request(router, 'GET', '/services/catalog', lab, {}, { page: '99', limit: '15' });
  assert.equal(last.body.pagination.page, 9); assert.equal(offset, 120);
  await request(router, 'GET', '/services/catalog', lab, {}, { page: '1', limit: '1000' });
  assert.equal(limit, 100);
  for (const page of ['0', '-1', '1.5', 'NaN', 'Infinity']) {
    assert.equal((await request(router, 'GET', '/services/catalog', lab, {}, { page })).status, 400);
  }
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
  const router = load({ User: { exists: async () => true }, Request: { findOne(f) { filter = f; return { select() { return this; }, populate() { return this; }, lean: async () => null }; } } });
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

test('laboratory can complete an owned request with no results', async () => {
  let mutation;
  const router=load({User:{exists:async()=>true},Request:{findOneAndUpdate:async(filter,update)=>{mutation={filter,update};return {};}}});
  const result=await request(router,'PATCH','/aaaaaaaaaaaaaaaaaaaaaaaa/complete',{_id:'dddddddddddddddddddddddd',role:'Lab'},{results:''});
  assert.equal(result.status,200);assert.equal(mutation.update.$set.results,'');assert.equal(mutation.update.$set.status,'completed');
  assert.equal(mutation.filter.deletedAt,null);assert.equal(mutation.filter.laboratoryId,'dddddddddddddddddddddddd');
});
test('empty and partial result drafts save without completing and only include requested tests', async () => {
  let mutation;
  const stored={_id:'aaaaaaaaaaaaaaaaaaaaaaaa',tests:['CBC']};
  const router=load({User:{exists:async()=>true},Request:{findOne:async()=>stored,findOneAndUpdate(filter,update){mutation={filter,update};return {select:async()=>stored};}}});
  const lab={_id:'dddddddddddddddddddddddd',role:'Lab'};
  assert.equal((await request(router,'PATCH','/aaaaaaaaaaaaaaaaaaaaaaaa/draft',doctor,{resultDraft:[]})).status,403);
  assert.equal((await request(router,'PATCH','/aaaaaaaaaaaaaaaaaaaaaaaa/draft',lab,{resultDraft:[]})).status,200);
  assert.equal(mutation.update.$set.status,undefined);assert.equal(mutation.filter.deletedAt,null);
  assert.equal((await request(router,'PATCH','/aaaaaaaaaaaaaaaaaaaaaaaa/draft',lab,{resultDraft:[{name:'CBC',value:JSON.stringify({wbc:'6'})}]})).status,200);
  assert.equal(mutation.update.$set.resultDraft[0].value,JSON.stringify({wbc:'6'}));
  assert.equal((await request(router,'PATCH','/aaaaaaaaaaaaaaaaaaaaaaaa/draft',lab,{resultDraft:[{name:'Other',value:'123'}]})).status,400);
});
test('deleting is laboratory-owned, soft, and disallowed for doctors', async () => {
  let mutation;
  const router=load({User:{exists:async()=>true},Request:{findOneAndUpdate:async(filter,update)=>{mutation={filter,update};return {};}}});
  const url='/aaaaaaaaaaaaaaaaaaaaaaaa';
  assert.equal((await request(router,'DELETE',url,doctor)).status,403);
  const lab={_id:'dddddddddddddddddddddddd',role:'Lab'};
  assert.equal((await request(router,'DELETE',url,lab)).status,200);
  assert.equal(mutation.filter.laboratoryId,lab._id);assert.equal(mutation.filter.deletedAt,null);
  assert.equal(typeof mutation.update.$set.deletedAt.toISOString(),'string');
});
