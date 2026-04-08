/**
 * Migration script: Sync reference ranges into MedicalTest documents in MongoDB.
 * Uses EXACT name matching only to avoid false positives.
 *
 * Run:  node syncReferenceRanges.js
 */
const mongoose = require('mongoose');
const MedicalTest = require('./models/MedicalTest');

// ── Mapping: exact DB test name → { unit, ranges } ──
const EXACT_MAP = {
  // Liver function
  'SGPT (ALT)':       { unit: 'U/L', ranges: 'Men: <45 | Women: <34' },
  'SGOT (AST)':       { unit: 'U/L', ranges: 'Men: <35 | Women: <31' },
  'ALK-Phosphatase':  { unit: 'U/L', ranges: 'Men: 50-190 | Women: 40-190 | Children <17: Up to 300 | Children <15: Up to 400' },
  'Bilirubin (T)':    { unit: 'mg/dL', ranges: 'Adult: Up to 1.1 | Newborn: Up to 13.3' },
  'Bilirubin (D)':    { unit: 'mg/dL', ranges: 'Direct: Up to 0.3' },
  'Albumin':          { unit: 'g/dL', ranges: 'Normal: 3.8-5.1' },
  'GGT':              { unit: 'U/L', ranges: 'Men: 8-61 | Women: 5-36' },
  'LDH':              { unit: 'U/L', ranges: 'Adult: 125-220' },
  'Globulin':         { unit: 'g/dL', ranges: 'Normal: 2.0-3.5' },

  // Lipid profile
  'Cholesterol':      { unit: 'mg/dl', ranges: 'Adult: ≤190' },
  'Triglycerides':    { unit: 'mg/dl', ranges: 'Suspect: >150 | High: >200' },
  'HDL - cholesterol':{ unit: 'mg/dl', ranges: 'Men: Low Risk >55, Moderate 35-55, High Risk <40 | Women: Low Risk >65, Moderate 45-65, High Risk <45' },
  'LDL-cholesterol':  { unit: 'mg/dl', ranges: 'Optimal: <100 | Borderline: 100-129 | High: 130-159' },

  // Kidney function
  'Creatinine, serum':{ unit: 'mg/dL', ranges: 'Men: 0.6-1.1 | Women: 0.5-0.9' },
  'BUN':              { unit: 'mg/dL', ranges: 'Adult: 6.0-23.0 | Children: 5.0-18.0 | Infant ≥1Y: 4.0-19.0' },
  'Uric Acid, serum': { unit: 'mg/dL', ranges: 'Men: 3.4-7.0 | Women: 2.4-5.7' },

  // Diabetes
  'Hb A1c':           { unit: '%', ranges: 'Normal: 4.8-5.8 | Pre-Diabetic: 5.9-6.4 | Diabetic: ≥6.5' },
  'FBG or RBG or PPBG': { unit: 'mg/dl', ranges: 'FBG: 70-100 | RBG: <140 | PPBG: <140' },

  // Minerals & Electrolytes
  'Ca, serum':        { unit: 'mg/dl', ranges: 'Adult: 8.6-10.3 | 0-5d: 7.9-10.7 | 1-3Y: 8.7-9.8 | 4-9Y: 8.8-10.1' },
  'Mg':               { unit: 'mg/dl', ranges: 'Normal: 1.9-2.5' },
  'Iron':             { unit: 'μg/dl', ranges: 'Male: 59-158 | Female: 37-145' },
  'Zinc (serum, semen)': { unit: 'μg/dl', ranges: 'Adult ≥20Y: 46.0-150.0 | Female 14-19Y: 59.0-98.0' },
  'PO4, serum':       { unit: 'mg/dL', ranges: 'Adult: 2.5-4.5 | Children: 4.0-7.0' },
  'Potassium':        { unit: 'mEq/L', ranges: 'Adult: 3.5-5.0' },
  'Sodium':           { unit: 'mEq/L', ranges: 'Adult: 136-145' },

  // Hormones - Thyroid
  'TSH':              { unit: 'mIU/L', ranges: '≥20Y: 0.3-4.20 | >11-≤20Y: 0.5-4.30 | >6-≤11Y: 0.6-4.84 | 1-6Y: 0.70-5.97' },
  'Free T4':          { unit: 'ng/dl', ranges: 'Normal: 0.78-1.55' },
  'Free T3':          { unit: 'pg/ml', ranges: 'Normal: 1.8-4.6' },
  'T3, total':        { unit: 'ng/dl', ranges: 'Adult: 0.8-2.0' },
  'T4, total':        { unit: 'μg/dl', ranges: 'Adult: 5.1-14.1' },
  'Thyroid Peroxidase Abs': { unit: 'IU/ml', ranges: 'Up to 34' },
  'TSH receptor Abs (TSI)': { unit: 'IU/L', ranges: 'Negative: <1.8 | Grey zone: 1.8-2.0 | Positive: >2.0' },
  'Thyroglobulin Abs':{ unit: 'IU/ml', ranges: 'Up to 115' },
  'Thyroglobulin level': { unit: 'ng/ml', ranges: '1.4-78.0' },
  'PTH':              { unit: 'pg/ml', ranges: '15-65' },
  'Calcitonin':       { unit: 'pg/ml', ranges: 'Male: <8.4 | Female: <5.0' },

  // Hormones - Reproductive
  'Prolactin':        { unit: 'ng/ml', ranges: 'Male: 3.45-17.42 | Female (non-pregnant): 4.60-25.07' },
  'FSH':              { unit: 'mIU/ml', ranges: 'Male: 1.5-12.4 | Female Follicular: 3.5-12.5 | Midcycle: 4.7-21.5 | Luteal: 1.7-7.7 | Menopausal: 25.8-134.8' },
  'LH':               { unit: 'mIU/ml', ranges: 'Male: 1.7-8.6 | Female Follicular: 2.4-12.6 | Midcycle: 14.0-95.6 | Luteal: 1.0-11.4 | Menopausal: 7.7-58.5' },
  'Progesterone':     { unit: 'ng/ml', ranges: 'Male: 0.2-1.4 | Female Follicular: 0.2-1.5 | Luteal: 1.7-27.0 | Menopausal: 0.1-0.8' },
  'Testosterone total': { unit: 'ng/dl', ranges: 'Male: 249-836 | Female: 6-82' },
  '17 - Beta Estradiol (E2)': { unit: 'pg/ml', ranges: 'Male: 11-44 | Female Follicular: 12.5-166 | Midcycle: 85.8-498 | Luteal: 43.8-211 | Menopausal: <54.7' },
  'Estradiol (E2)':   { unit: 'pg/ml', ranges: 'Male: 11-44 | Female Follicular: 12.5-166 | Midcycle: 85.8-498 | Luteal: 43.8-211 | Menopausal: <54.7' },
  'DHEAS':            { unit: 'μg/dl', ranges: 'Male: 80-560 | Female: 35-430' },
  'BHCG Quantitative':{ unit: 'mIU/ml', ranges: 'Non-pregnant: <5 | Pregnant varies by week' },
  'Anti-Mullerian Hormone': { unit: 'ng/ml', ranges: 'Female: 1.0-3.5 (age-dependent)' },
  'Sex Hormone Binding Globulin': { unit: 'nmol/L', ranges: 'Male: 18.3-54.1 | Female: 24.6-122.0' },

  // Serology / Immunology
  'CRP':              { unit: 'mg/L', ranges: '<6.0' },
  'C- Reactive Protien - High Sensitive': { unit: 'mg/L', ranges: '<6.0' },
  'RF':               { unit: 'IU/ml', ranges: '<14.0' },
  'Rheumatoid Factor, Quantitative': { unit: 'IU/ml', ranges: '<14.0' },
  'ASOT':             { unit: 'IU/ml', ranges: '<200' },
  'ESR':              { unit: 'mm/hr', ranges: 'Male: 0-15 | Female: 0-20' },

  // Iron studies & vitamins
  'Ferritin':         { unit: 'ng/ml', ranges: 'Male: 30-400 | Female: 12-150' },
  'TIBC':             { unit: 'μg/dl', ranges: '250-370' },
  'Transferrin':      { unit: 'mg/dL', ranges: '200-360' },
  'Vitamin B12':      { unit: 'pg/ml', ranges: '200-900' },
  '25-OH-Vitamin D3': { unit: 'ng/ml', ranges: 'Insufficient: <30 | Sufficient: 30.0-100.0' },
  'Folate, serum':    { unit: 'ng/ml', ranges: '3.1-17.5' },

  // Immunoglobulins / Complement
  'IgA':              { unit: 'mg/dL', ranges: 'Adult: 70-400' },
  'IgG':              { unit: 'mg/dL', ranges: 'Adult: 700-1600' },
  'IgM':              { unit: 'mg/dL', ranges: 'Adult: 40-230' },
  'IgE':              { unit: 'IU/ml', ranges: 'Adult: <100' },
  'C3':               { unit: 'mg/dL', ranges: '90-180' },
  'C4':               { unit: 'mg/dL', ranges: '10-40' },

  // Coagulation
  'PT':               { unit: 'seconds', ranges: '11-13.5' },
  'PTT':              { unit: 'seconds', ranges: '25-35' },
  'APTT':             { unit: 'seconds', ranges: '25-35' },
  'D-dimer':          { unit: 'ng/ml', ranges: '<500' },
  'Fibrinogen':       { unit: 'mg/dL', ranges: '200-400' },

  // Tumor markers
  'CEA':              { unit: 'ng/ml', ranges: 'Non-smoker: <3.0 | Smoker: <5.0' },
  'CA-125':           { unit: 'U/ml', ranges: '<35' },
  'CA-15-3':          { unit: 'U/ml', ranges: '<25' },
  'CA-19-9':          { unit: 'U/ml', ranges: '<37' },
  'CA 72.4':          { unit: 'U/ml', ranges: '<6.9' },
  'PSA total':        { unit: 'ng/ml', ranges: '<4.0' },
  'PSA free':         { unit: 'ng/ml', ranges: 'Ratio free/total >25%' },
  'AFP (GA or LMP needed)': { unit: 'ng/ml', ranges: 'Adult: <10' },

  // Cardiac
  'CK':               { unit: 'U/L', ranges: 'Male: 39-308 | Female: 26-192' },
  'CK-MB':            { unit: 'U/L', ranges: '<24' },
  'Troponin I, quantitative': { unit: 'ng/ml', ranges: '<0.04' },
  'Troponin I - Quantitative': { unit: 'ng/ml', ranges: '<0.04' },
  'Troponin I, qualitative': { unit: 'ng/ml', ranges: 'Negative: <0.04' },

  // Other enzymes / misc
  'Amylase, serum':   { unit: 'U/L', ranges: '28-100' },
  'Lipase':           { unit: 'U/L', ranges: '13-60' },
  'Homocysteine':     { unit: 'μmol/L', ranges: '5-15' },
  'Cortisol serum':   { unit: 'μg/dL', ranges: 'Morning: 6.2-19.4 | Evening: 2.3-11.9' },
  'Insulin':          { unit: 'μIU/ml', ranges: 'Fasting: 2.6-24.9' },
  'C-peptide':        { unit: 'ng/ml', ranges: '1.1-4.4' },
  'Procalcitonin':    { unit: 'ng/ml', ranges: '<0.5 normal | 0.5-2 possible infection | >2 severe infection' },
  'Erythropoietin':   { unit: 'mIU/ml', ranges: '4.3-29.0' },
  'Growth Hormone':   { unit: 'ng/ml', ranges: 'Adult: <5' },
  'ACTH':             { unit: 'pg/ml', ranges: 'Morning: 7.2-63.3' },
  'Ammonia':          { unit: 'μmol/L', ranges: 'Adult: 11-32' },
  'Haptoglobin':      { unit: 'mg/dL', ranges: '30-200' },
  'Ceruloplasmin':    { unit: 'mg/dL', ranges: '20-60' },
  'IGF1':             { unit: 'ng/ml', ranges: 'Age-dependent' },
  'Lead':             { unit: 'μg/dL', ranges: 'Adult: <10 | Children: <5' },
  'Lithium':          { unit: 'mEq/L', ranges: 'Therapeutic: 0.6-1.2' },
};

async function run() {
  await mongoose.connect('mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net');
  console.log('Connected to MongoDB\n');

  // First: RESET all values from the previous (buggy) run
  const resetResult = await MedicalTest.updateMany(
    { isActive: true },
    { $set: { normalRange: '', unit: '' } }
  );
  console.log(`🔄 Reset ${resetResult.modifiedCount} tests to empty normalRange/unit\n`);

  const allTests = await MedicalTest.find({ isActive: true }).lean();
  console.log(`Found ${allTests.length} active tests\n`);

  const bulkOps = [];

  for (const dbTest of allTests) {
    const ref = EXACT_MAP[dbTest.name];
    if (ref) {
      bulkOps.push({
        updateOne: {
          filter: { _id: dbTest._id },
          update: { $set: { normalRange: ref.ranges, unit: ref.unit } }
        }
      });
      console.log(`✅ ${dbTest.name}  →  unit: ${ref.unit} | range: ${ref.ranges.substring(0, 60)}`);
    }
  }

  if (bulkOps.length > 0) {
    const result = await MedicalTest.bulkWrite(bulkOps);
    console.log(`\n🎉 Updated ${result.modifiedCount} tests in the database`);
  } else {
    console.log('\nNo tests matched');
  }

  const withData = await MedicalTest.countDocuments({ isActive: true, normalRange: { $ne: '' }, unit: { $ne: '' } });
  const total = await MedicalTest.countDocuments({ isActive: true });
  console.log(`\n📊 ${withData}/${total} tests now have normalRange & unit`);
  console.log(`ℹ️  ${total - withData} tests don't have known reference ranges (cultures, specialized tests, etc.)\n`);

  await mongoose.disconnect();
  console.log('Done!');
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
