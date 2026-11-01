const { test } = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../scripts/futureLaboratoryCatalog.json');
const { resolveTemplate } = require('../utils/laboratoryTemplates');
const fs = require('node:fs');
const path = require('node:path');
test('all 78 catalog tests resolve to named fields rather than generic result labels', () => {
  assert.equal(catalog.length, 78);
  for (const service of catalog) {
    const result = resolveTemplate({ ...service, fields: [] });
    assert.ok(result.resultFields.length, service.name);
    assert.ok(result.resultFields.every(field => !['Result','النتيجة'].includes(field.label)), service.name);
    assert.equal(new Set(result.resultFields.map(f => f.key)).size, result.resultFields.length);
  }
});
test('complex tests use the existing technician forms; cultures cannot become urinalysis', () => {
  assert.equal(resolveTemplate({name:'CBC'}).templateName,'CBC');
  assert.equal(resolveTemplate({name:'Urine Analysis'}).templateName,'Urine Analysis');
  const culture=resolveTemplate({name:'Urine Culture'});
  assert.equal(culture.templateName,null);
  assert.ok(culture.resultFields.some(f=>f.label==='Organism'));
  assert.ok(resolveTemplate({name:'PT'}).resultFields.some(f=>f.label==='INR'));
});
test('provider edits remain isolated; obsolete generic-only fields resolve to the correct template', () => {
  const original=[{label:'Custom WBC',key:'wbc',unit:'custom'}];
  const custom=resolveTemplate({name:'CBC',fields:original});
  assert.equal(custom.templateSource,'laboratory');assert.equal(custom.resultFields[0].label,'Custom WBC');
  const other=resolveTemplate({name:'CBC',fields:[]});
  assert.equal(other.templateSource,'standard');assert.equal(other.resultFields.length,12);
  assert.equal(resolveTemplate({name:'CBC',fields:[{label:'Result'}]}).resultFields.length,12);
  assert.equal(resolveTemplate({name:'Unknown custom test'}).templateSource,'missing');
});
test('mobile schemas cover the actual technician urine and stool form keys', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../vita-front/src/components/lab/LabTestForms.jsx'), 'utf8');
  for (const [name,start,end] of [['Urine Analysis','const UrineAnalysisForm','const StoolAnalysisForm'],['Stool Analysis','const StoolAnalysisForm','const GTTForm']]) {
    const section = source.slice(source.indexOf(start), source.indexOf(end));
    const keys = new Set([...section.matchAll(/data\.([a-zA-Z0-9_]+)/g)].map(match => match[1]));
    for (const match of section.matchAll(/(?:renderGradeField|renderFewManyField|notSeenField)\('[^']*', '([^']+)'/g)) keys.add(match[1]);
    const fields = new Set(resolveTemplate({name}).resultFields.map(f => f.key));
    for (const key of keys) assert.ok(fields.has(key), `${name}: ${key}`);
  }
});
