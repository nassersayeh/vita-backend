/**
 * Script: Import tests from تسعيرة النقابة 2018 XLS file
 * 
 * This script:
 * 1. Reads the XLS file with 495 lab tests and prices
 * 2. Imports all tests into the MedicalTest collection
 * 3. Creates LabTestPricing records for all Lab and LabTech users
 *    linking each user to all tests with the union (نقابة) prices
 *
 * Usage: node scripts/importLabTests.js
 */

const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
const MedicalTest = require('../models/MedicalTest');
const LabTestPricing = require('../models/LabTestPricing');
const User = require('../models/User');

const MONGO_URI = 'mongodb+srv://nassersayeh:pop1990@cluster0.vefyn0g.mongodb.net/?appName=Cluster0';
const XLS_PATH = path.join(__dirname, '../../vita-web/src/utils/تسعيرة النقابة 2018.xls');

// Categorize tests based on their name
function categorizeTest(testName) {
  const name = testName.toLowerCase();
  
  // Hormones
  if (name.includes('hormone') || name.includes('estradiol') || name.includes('progesterone') ||
      name.includes('testosterone') || name.includes('cortisol') || name.includes('acth') ||
      name.includes('fsh') || name.includes('lh') || name.includes('prolactin') ||
      name.includes('thyroid') || name.includes('tsh') || name.includes('t3') || name.includes('t4') ||
      name.includes('insulin') || name.includes('hcg') || name.includes('dhea') ||
      name.includes('aldosterone') || name.includes('renin') || name.includes('pth') ||
      name.includes('growth hormone') || name.includes('gh ') || name.includes('igf') ||
      name.includes('ketosteroid') || name.includes('hydroxylase') || name.includes('deoxycorticol') ||
      name.includes('androstenedione') || name.includes('calcitonin') || name.includes('erythropoietin') ||
      name.includes('inhibin') || name.includes('anti-mullerian') || name.includes('amh')) {
    return 'Hormones';
  }
  
  // Hematology
  if (name.includes('cbc') || name.includes('blood count') || name.includes('hemoglobin') ||
      name.includes('hematocrit') || name.includes('platelet') || name.includes('wbc') ||
      name.includes('rbc') || name.includes('reticulocyte') || name.includes('esr') ||
      name.includes('sedimentation') || name.includes('coagulation') || name.includes('pt ') ||
      name.includes('ptt') || name.includes('inr') || name.includes('fibrinogen') ||
      name.includes('bleeding time') || name.includes('clotting') || name.includes('d-dimer') ||
      name.includes('factor') && (name.includes('viii') || name.includes('vii') || name.includes('ix') || name.includes('xi') || name.includes('xiii')) ||
      name.includes('vwf') || name.includes('antithrombin') || name.includes('protein c') ||
      name.includes('protein s') || name.includes('lupus anticoagulant') || name.includes('blood group') ||
      name.includes('coombs') || name.includes('blood film') || name.includes('peripheral smear') ||
      name.includes('sickling') || name.includes('hb electrophoresis') || name.includes('hba') ||
      name.includes('g6pd') || name.includes('osmotic fragility')) {
    return 'Hematology';
  }
  
  // Chemistry / Biochemistry
  if (name.includes('glucose') || name.includes('sugar') || name.includes('hba1c') ||
      name.includes('cholesterol') || name.includes('triglyceride') || name.includes('hdl') ||
      name.includes('ldl') || name.includes('lipid') || name.includes('urea') ||
      name.includes('creatinine') || name.includes('uric acid') || name.includes('bilirubin') ||
      name.includes('albumin') || name.includes('protein') && !name.includes('c-reactive') ||
      name.includes('ast') || name.includes('alt') || name.includes('sgot') || name.includes('sgpt') ||
      name.includes('alkaline phosphatase') || name.includes('ggt') || name.includes('ldh') ||
      name.includes('cpk') || name.includes('ck-') || name.includes('amylase') || name.includes('lipase') ||
      name.includes('calcium') || name.includes('phosphorus') || name.includes('magnesium') ||
      name.includes('sodium') || name.includes('potassium') || name.includes('chloride') ||
      name.includes('bicarbonate') || name.includes('iron') || name.includes('ferritin') ||
      name.includes('tibc') || name.includes('transferrin') || name.includes('electrolyte') ||
      name.includes('total protein') || name.includes('globulin') || name.includes('a/g ratio') ||
      name.includes('bun') || name.includes('acid-phosphatase') || name.includes('copper') ||
      name.includes('zinc') || name.includes('lead') || name.includes('lithium') ||
      name.includes('ammonia') || name.includes('lactate') || name.includes('blood gas') ||
      name.includes('abg')) {
    return 'Chemistry';
  }
  
  // Immunology / Serology
  if (name.includes('antibod') || name.includes('abs') || name.includes('igg') ||
      name.includes('igm') || name.includes('iga') || name.includes('ige') ||
      name.includes('immunoglobulin') || name.includes('complement') || name.includes('c3') ||
      name.includes('c4') || name.includes('ana') || name.includes('anti-nuclear') ||
      name.includes('anti-ds') || name.includes('anca') || name.includes('rheumatoid') ||
      name.includes('rf ') || name.includes('crp') || name.includes('c-reactive') ||
      name.includes('aso') || name.includes('anti-strep') || name.includes('widal') ||
      name.includes('brucella') || name.includes('toxoplasma') || name.includes('rubella') ||
      name.includes('cmv') || name.includes('ebv') || name.includes('herpes') ||
      name.includes('hsv') || name.includes('vzv') || name.includes('measles') ||
      name.includes('mumps') || name.includes('hiv') || name.includes('hepatitis') ||
      name.includes('hbs') || name.includes('hcv') || name.includes('hbe') ||
      name.includes('anti-hb') || name.includes('elisa') || name.includes('western blot') ||
      name.includes('immunofix') || name.includes('cryoglobulin') || name.includes('autoimmune') ||
      name.includes('allergy') || name.includes('allergen') || name.includes('anti-ccp') ||
      name.includes('anti-gliadin') || name.includes('anti-tissue') || name.includes('celiac') ||
      name.includes('tpo') || name.includes('thyroglobulin') || name.includes('anti-thyroid') ||
      name.includes('adenovirus') || name.includes('parvovirus') || name.includes('acetylcholine') ||
      name.includes('ganglioside') || name.includes('cardiolipin') || name.includes('beta-2') ||
      name.includes('phospholipid')) {
    return 'Immunology';
  }
  
  // Microbiology
  if (name.includes('culture') || name.includes('sensitivity') || name.includes('gram stain') ||
      name.includes('afb') || name.includes('fungal') || name.includes('parasite') ||
      name.includes('ova') || name.includes('stool') && name.includes('exam') ||
      name.includes('urine') && name.includes('exam') || name.includes('koh') ||
      name.includes('malaria') || name.includes('tb') || name.includes('tuberculosis') ||
      name.includes('quantiferon')) {
    return 'Microbiology';
  }
  
  // Tumor Markers
  if (name.includes('tumor marker') || name.includes('cea') || name.includes('afp') ||
      name.includes('alpha-fetoprotein') || name.includes('ca-') || name.includes('ca ') ||
      name.includes('ca125') || name.includes('ca15') || name.includes('ca19') ||
      name.includes('psa') || name.includes('nse') || name.includes('scc') ||
      name.includes('cyfra') || name.includes('chromogranin') || name.includes('her-2') ||
      name.includes('calcitonin') || name.includes('s-100') || name.includes('beta-2 microglobulin')) {
    return 'Tumor Markers';
  }
  
  // Vitamins & Nutrition
  if (name.includes('vitamin') || name.includes('folate') || name.includes('folic') ||
      name.includes('b12') || name.includes('homocysteine') || name.includes('methylmalonic') ||
      name.includes('carnitine') || name.includes('fatty acid')) {
    return 'Vitamins';
  }
  
  // Urinalysis
  if (name.includes('urine') || name.includes('urinalysis') || name.includes('24 hr') ||
      name.includes('24hr') || name.includes('creatinine clearance') || name.includes('microalbumin') ||
      name.includes('urine protein') || name.includes('urine calcium') || name.includes('urine glucose')) {
    return 'Urinalysis';
  }
  
  // Genetics / Molecular
  if (name.includes('dna') || name.includes('rna') || name.includes('pcr') ||
      name.includes('gene') || name.includes('chromosome') || name.includes('karyotype') ||
      name.includes('fish') || name.includes('mutation') || name.includes('microdeletion') ||
      name.includes('hla') || name.includes('paternity') || name.includes('electrophoresis') && name.includes('protein') ||
      name.includes('genotyp')) {
    return 'Genetics';
  }
  
  // Drug Monitoring
  if (name.includes('drug') || name.includes('therapeutic') || name.includes('level') ||
      name.includes('phenytoin') || name.includes('carbamazepine') || name.includes('valproic') ||
      name.includes('digoxin') || name.includes('theophylline') || name.includes('cyclosporine') ||
      name.includes('tacrolimus') || name.includes('methotrexate') || name.includes('vancomycin') ||
      name.includes('gentamicin') || name.includes('phenobarbital')) {
    return 'Drug Monitoring';
  }
  
  return 'General';
}

async function importLabTests() {
  try {
    console.log('📋 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Step 1: Read XLS file
    console.log('📖 Reading XLS file...');
    const workbook = XLSX.readFile(XLS_PATH);
    const sheet = workbook.Sheets['Sheet1'];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    // Skip header row
    const testRows = data.slice(1).filter(row => row && row[1] && row[2] !== undefined);
    console.log(`✅ Found ${testRows.length} tests in XLS file\n`);

    // Step 2: Import tests into MedicalTest collection
    console.log('🔬 Importing tests into MedicalTest collection...');
    let imported = 0;
    let skipped = 0;
    const testIdMap = {}; // testName -> testId

    for (const row of testRows) {
      const testName = String(row[1]).trim();
      const price = Number(row[2]) || 0;
      const category = categorizeTest(testName);

      try {
        // Use upsert to avoid duplicates
        const result = await MedicalTest.findOneAndUpdate(
          { name: testName },
          {
            $setOnInsert: {
              name: testName,
              type: 'laboratory',
              category: category,
              price: price,
              description: `تسعيرة نقابة المختبرات 2018 - ${testName}`,
              isActive: true,
            }
          },
          { upsert: true, new: true }
        );
        testIdMap[testName] = { id: result._id, price: price };
        imported++;
      } catch (err) {
        if (err.code === 11000) {
          // Duplicate - get existing
          const existing = await MedicalTest.findOne({ name: testName });
          if (existing) {
            testIdMap[testName] = { id: existing._id, price: price };
          }
          skipped++;
        } else {
          console.error(`  ❌ Error importing "${testName}":`, err.message);
        }
      }
    }
    console.log(`✅ Imported: ${imported} | Skipped (already exist): ${skipped}\n`);

    // Step 3: Get all Lab and LabTech users
    console.log('👨‍🔬 Finding Lab and LabTech users...');
    const labUsers = await User.find({ role: { $in: ['Lab', 'LabTech'] } }).select('_id fullName role').lean();
    console.log(`✅ Found ${labUsers.length} lab/labtech users\n`);

    if (labUsers.length === 0) {
      console.log('⚠️  No Lab or LabTech users found. Tests are imported but no pricing records created.');
      await mongoose.disconnect();
      return;
    }

    // Step 4: Create LabTestPricing for each lab user
    console.log('💰 Creating LabTestPricing records...');
    const testEntries = Object.values(testIdMap).map(t => ({
      testId: t.id,
      price: t.price,
      isAvailable: true
    }));

    let pricingCreated = 0;
    let pricingUpdated = 0;

    for (const labUser of labUsers) {
      try {
        const existing = await LabTestPricing.findOne({ labId: labUser._id });
        
        if (existing) {
          // Merge new tests with existing ones (don't overwrite existing prices)
          const existingTestIds = new Set(existing.tests.map(t => t.testId.toString()));
          const newTests = testEntries.filter(t => !existingTestIds.has(t.testId.toString()));
          
          if (newTests.length > 0) {
            existing.tests.push(...newTests);
            existing.pricingSource = 'تسعيرة نقابة المختبرات 2018';
            existing.lastUpdated = new Date();
            await existing.save();
            console.log(`  📝 Updated ${labUser.fullName} (${labUser.role}) - added ${newTests.length} new tests`);
            pricingUpdated++;
          } else {
            console.log(`  ⏭️  ${labUser.fullName} (${labUser.role}) - already has all tests`);
          }
        } else {
          // Create new pricing record
          await LabTestPricing.create({
            labId: labUser._id,
            tests: testEntries,
            currency: 'ILS',
            pricingSource: 'تسعيرة نقابة المختبرات 2018',
            lastUpdated: new Date()
          });
          console.log(`  ✅ Created pricing for ${labUser.fullName} (${labUser.role}) - ${testEntries.length} tests`);
          pricingCreated++;
        }
      } catch (err) {
        console.error(`  ❌ Error creating pricing for ${labUser.fullName}:`, err.message);
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`  Tests in MedicalTest collection: ${Object.keys(testIdMap).length}`);
    console.log(`  New pricing records created: ${pricingCreated}`);
    console.log(`  Existing pricing records updated: ${pricingUpdated}`);
    console.log(`  Each lab/labtech has ${testEntries.length} tests with نقابة prices`);

    // Print category breakdown
    const categoryCounts = {};
    for (const testName of Object.keys(testIdMap)) {
      const cat = categorizeTest(testName);
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
    console.log('\n📂 Category Breakdown:');
    Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
      console.log(`  ${cat}: ${count} tests`);
    });

    await mongoose.disconnect();
    console.log('\n✅ Done!');
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

importLabTests();
