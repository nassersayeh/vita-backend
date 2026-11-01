const catalog = require('../scripts/futureLaboratoryCatalog.json');
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, '');
const known = new Map(catalog.map(item => [normalize(item.name), item.name]));
const field = (label, key = label, type = 'text', options = []) => ({ label, key, type, options, unit: '', normalRange: '' });
const groups = {
  cbc: { templateName: 'CBC', fields: [['WBC Count, total','wbc'],['Lymphocytes','lymphocytes'],['MID','mid'],['Granulocytes','granulocytes'],['Hemoglobin (Hb)','hemoglobin'],['MCH','mch'],['MCHC','mchc'],["RBC count",'rbc'],['MCV','mcv'],['Hematocrit (HCT)','hct'],['RDW-SD','rdwsd'],['Platelet Count','platelet']].map(([label,key]) => field(label,key)) },
  bloodgroup: { templateName: 'Blood Group', fields: [field('فصيلة الدم ABO','aboGroup','select',['A','B','AB','O']), field('عامل Rh','rhFactor','select',['Positive','Negative'])] },
  urineanalysis: { templateName: 'Urine Analysis', fields: [['Color','color'],['Appearance','appearance'],['Specific Gravity','specificGravity'],['pH','ph'],['Leukocytes','leukocytes'],['Urobilinogen','urobilinogen'],['Bilirubin','bilirubin'],['Blood','blood'],['Nitrite','nitrite'],['Protein','protein'],['Glucose','glucose'],['Ketone','ketone'],['RBCs /HPF','rbcs'],['WBCs /HPF','wbcs'],['Epithelial Cells','epithelialCells'],['Bacteria','bacteria'],['Mucus','mucus'],['Crystals','crystals'],['Amorphous','amorphous'],['Casts','casts']].map(([label,key]) => field(label,key)) },
  stoolanalysis: { templateName: 'Stool Analysis', fields: [['Color','color'],['Consistency','consistency'],['Blood','blood'],['Occult Blood','occultBlood'],['H. pylori Ag','hpyloriAg'],['RBCs','rbcs'],['WBCs','wbcs'],['Ova','ova'],['Parasites','parasites'],['Cysts','cysts'],['Yeast Cells','yeastCells'],['Remarks','remarks']].map(([label,key]) => field(label,key)) },
  pregnancytest: { templateName: 'Pregnancy test', fields: [field('آخر دورة شهرية','lmp'),field('فحص الحمل','result','select',['Positive','Equivocal','Negative'])] },
  pt: { fields: ['PT (Patient)','PT (Control)','INR'].map(label => field(label)) },
  ptt: { fields: ['PTT (Patient)','PTT (Control)'].map(label => field(label)) },
  hbelectrophoresis: { fields: ['Hb A','Hb A2','Hb F','Other fractions','ملاحظات'].map(label => field(label)) },
  semenanalysis: { fields: ['Volume','Appearance','Liquefaction','Viscosity','pH','Sperm concentration','Total count','Progressive motility','Non-progressive motility','Immotile','Morphology','WBC','RBC','ملاحظات'].map(label => field(label)) },
};
// The same option values used by the existing technician's urine/stool forms.
const urineOptions = {
  color: ['Straw','Yellow','Pale Yellow','Dark Yellow','Red','Reddish','Brown'],
  appearance: ['Clear','Cloudy','Slightly Hazy','Hazy','Turbid'], specificGravity: ['1.000','1.005','1.010','1.015','1.020','1.025','1.030'],
  nitrite: ['Negative','Positive'], protein: ['Negative','Trace','+1','+2','+3','+4'],
  urobilinogen: ['Normal','+1','+2','+3'], bilirubin: ['Negative','+1','+2','+3'], ketone: ['Negative','+1','+2','+3'],
  leukocytes: ['Negative','+1','+2','+3','+4'], blood: ['Negative','+1','+2','+3','+4'], glucose: ['Negative','+1','+2','+3','+4'],
  epithelialCells: ['None','Few','Moderate','Many'], bacteria: ['None','Few','Moderate','Many'], mucus: ['Not Seen','Seen'],
  crystals: ['Not Seen','Calcium Oxalate','Triple Phosphate','Uric Acid','Calcium Carbonate','Tyrosine','Ammonium Biurate'],
  casts: ['Not Seen','Granular Cast','Epithelial Cast','Bacterial Cast','Cellular Cast','Hyaline Cast','Fatty Cast','Erythrocyte Cast'],
  amorphous: ['Not Seen','Amorphous Urate','Amorphous Phosphate'],
};
groups.urineanalysis.fields = groups.urineanalysis.fields.map(f => urineOptions[f.key] ? { ...f, type: 'select', options: urineOptions[f.key] } : f);
groups.stoolanalysis.fields = groups.stoolanalysis.fields.map(f => ['ova','parasites','cysts','yeastCells'].includes(f.key) ? { ...f, type: 'select', options: ['Not seen','Seen'] } : f.key === 'remarks' ? { ...f, type: 'textarea' } : f);
const aliases = { completebloodcount: 'cbc', aborh: 'bloodgroup', urinalysis: 'urineanalysis', stool: 'stoolanalysis', creatinin: 'creatinine', creatin: 'creatinine', triglycerid: 'triglycerides', vitd: 'vitamind', vitb12: 'vitaminb12', totalbilirubin: 'tbilirubin', directbilirubin: 'dbilirubin' };

function resolveTemplate(service) {
  const genericOnly = service.fields?.length === 1 && ['result','النتيجة','نتيجة'].includes(normalize(service.fields[0].label));
  if (service.fields?.length && !genericOnly) return { ...service, templateSource: 'laboratory', resultFields: service.fields.map(f => ({ ...f, key: f.key || f.label })) };
  const key = aliases[normalize(service.name)] || normalize(service.name);
  const group = groups[key];
  let fields = group?.fields;
  if (!fields && key.endsWith('culture')) fields = ['Specimen','Growth','Organism','Colony count','Antibiotic sensitivity','ملاحظات'].map(label => field(label));
  if (!fields && known.has(key)) fields = [field(known.get(key), 'result')];
  if (!fields) return { ...service, templateSource: 'missing', resultFields: [] };
  return { ...service, templateSource: 'standard', templateName: group?.templateName || null,
    resultFields: fields.map(f => ({ ...f, options: [...f.options], ...(fields.length === 1 ? { unit: service.unit || '', normalRange: service.normalRange || '' } : {}) })) };
}
module.exports = { resolveTemplate, normalize };
