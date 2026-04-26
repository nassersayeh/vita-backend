/**
 * Script: populateNormalRanges.js
 * يملأ حقل normalRanges[] لكل الفحوصات في قاعدة البيانات
 * بناءً على القائمة المرجعية من الفرونت
 */

require('dotenv').config();
const mongoose = require('mongoose');
const MedicalTest = require('../models/MedicalTest');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27017/vita?authSource=admin';

// ========== قاعدة بيانات النطاقات الطبيعية ==========
// gender: 'all' | 'male' | 'female'
// ageMin/ageMax: بالسنوات (0-999)
// range: النطاق الطبيعي
// unit: الوحدة

const REFERENCE_DB = [
  // ===== LIVER =====
  { keywords: ['gptalt', 'alt', 'gpt', 'sgpt'],       unit: 'U/L',    ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '<45' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '<34' }] },
  { keywords: ['gotast', 'ast', 'got', 'sgot'],        unit: 'U/L',    ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '<35' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '<31' }] },
  { keywords: ['alkalinephosphatase', 'alp', 'alk'],   unit: 'U/L',    ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '50-190' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '40-190' }, { gender: 'all', ageMin: 0, ageMax: 15, range: 'Up to 400' }, { gender: 'all', ageMin: 15, ageMax: 17, range: 'Up to 300' }] },
  { keywords: ['bilirubintotal', 'bilirubin'],         unit: 'mg/dL',  ranges: [{ gender: 'all', ageMin: 1, ageMax: 999, range: 'Up to 1.1' }, { gender: 'all', ageMin: 0, ageMax: 0, range: 'Up to 13.3' }], exclude: ['spectral', 'liley'] },
  { keywords: ['albumin'],                             unit: 'g/dL',   ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '3.8-5.1' }], exclude: ['micro'] },
  { keywords: ['globulin'],                            unit: 'g/dL',   ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '2.0-3.5' }] },
  { keywords: ['ggt', 'gammaglutamyl'],                unit: 'U/L',    ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '8-61' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '5-36' }] },
  { keywords: ['ldh', 'lactatedehydrogenase'],         unit: 'U/L',    ranges: [{ gender: 'all', ageMin: 18, ageMax: 999, range: '125-220' }] },
  { keywords: ['ammonia'],                             unit: 'μmol/L', ranges: [{ gender: 'all', ageMin: 18, ageMax: 999, range: '11-32' }] },
  { keywords: ['amylase'],                             unit: 'U/L',    ranges: [{ gender: 'all', ageMin: 18, ageMax: 999, range: '28-100' }], exclude: ['urine'] },
  { keywords: ['lipase'],                              unit: 'U/L',    ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '13-60' }] },

  // ===== LIPIDS =====
  { keywords: ['cholesteroltotal', 'cholesterol'],     unit: 'mg/dl',  ranges: [{ gender: 'all', ageMin: 18, ageMax: 999, range: '≤190' }] },
  { keywords: ['triglycerides'],                       unit: 'mg/dl',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<150' }] },
  { keywords: ['hdl'],                                 unit: 'mg/dl',  ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '>55' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '>65' }] },
  { keywords: ['ldl'],                                 unit: 'mg/dl',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<100' }] },

  // ===== KIDNEY =====
  { keywords: ['creatinine'],                          unit: 'mg/dL',  ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '0.6-1.1' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '0.5-0.9' }], exclude: ['clearance', 'clearence', 'ratio', 'urine'] },
  { keywords: ['urea'],                                unit: 'mg/dL',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '10.0-50.0' }] },
  { keywords: ['bun'],                                 unit: 'mg/dL',  ranges: [{ gender: 'all', ageMin: 18, ageMax: 999, range: '6.0-23.0' }, { gender: 'all', ageMin: 1, ageMax: 17, range: '5.0-18.0' }, { gender: 'all', ageMin: 0, ageMax: 1, range: '4.0-19.0' }] },
  { keywords: ['uricacid'],                            unit: 'mg/dL',  ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '3.4-7.0' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '2.4-5.7' }], exclude: ['urine'] },

  // ===== BLOOD SUGAR =====
  { keywords: ['rbs', 'randombloodsugar'],             unit: 'mg/dl',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<140' }] },
  { keywords: ['pps2'],                                unit: 'mg/dl',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<140' }] },
  { keywords: ['pps1'],                                unit: 'mg/dl',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<180' }] },
  { keywords: ['fastingbloodsugar', 'fbs'],            unit: 'mg/dl',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '70-100' }] },
  { keywords: ['hba1c', 'glycatedhemoglobin'],         unit: '%',      ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: 'Normal: 4.8-5.8 | Pre-Diabetic: 5.9-6.4 | Diabetic: ≥6.5' }] },
  { keywords: ['insulin'],                             unit: 'μIU/ml', ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '2.6-24.9' }] },
  { keywords: ['cpeptide'],                            unit: 'ng/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '1.1-4.4' }] },
  { keywords: ['procalcitonin'],                       unit: 'ng/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<0.5' }] },

  // ===== MINERALS & ELECTROLYTES =====
  { keywords: ['calcium', 'caserum'],                  unit: 'mg/dl',  ranges: [{ gender: 'all', ageMin: 16, ageMax: 999, range: '8.6-10.3' }, { gender: 'all', ageMin: 12, ageMax: 15, range: '9.2-10.7' }, { gender: 'all', ageMin: 10, ageMax: 11, range: '8.9-10.1' }, { gender: 'all', ageMin: 4, ageMax: 9, range: '8.8-10.1' }, { gender: 'all', ageMin: 1, ageMax: 3, range: '8.7-9.8' }, { gender: 'all', ageMin: 0, ageMax: 0, range: '7.9-10.7' }], exclude: ['ratio', 'urine'] },
  { keywords: ['magnesium', 'mg'],                      unit: 'mg/dl',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '1.9-2.5' }] },
  { keywords: ['phosphate', 'po4', 'phosphorus'],      unit: 'mg/dL',  ranges: [{ gender: 'all', ageMin: 18, ageMax: 999, range: '2.5-4.5' }, { gender: 'all', ageMin: 0, ageMax: 17, range: '4.0-7.0' }], exclude: ['urine'] },
  { keywords: ['sodium'],                              unit: 'mEq/L',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '136-145' }] },
  { keywords: ['potassium'],                           unit: 'mEq/L',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '3.5-5.0' }] },
  { keywords: ['iron'],                                unit: 'μg/dl',  ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '59-158' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '37-145' }] },
  { keywords: ['zinc'],                                unit: 'μg/dl',  ranges: [{ gender: 'all', ageMin: 20, ageMax: 999, range: '46.0-150.0' }, { gender: 'female', ageMin: 14, ageMax: 19, range: '59.0-98.0' }] },
  { keywords: ['tibc'],                                unit: 'μg/dl',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '250-370' }] },
  { keywords: ['transferrin'],                         unit: 'mg/dL',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '200-360' }] },
  { keywords: ['lead'],                                unit: 'μg/dL',  ranges: [{ gender: 'all', ageMin: 18, ageMax: 999, range: '<10' }, { gender: 'all', ageMin: 0, ageMax: 17, range: '<5' }] },
  { keywords: ['copper'],                              unit: 'μg/dL',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '70-140' }], exclude: ['urine'] },
  { keywords: ['ceruloplasmin'],                       unit: 'mg/dL',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '20-60' }] },

  // ===== HORMONES - Thyroid =====
  { keywords: ['tsh'],                                 unit: 'mIU/L',  ranges: [{ gender: 'all', ageMin: 20, ageMax: 999, range: '0.3-4.20' }, { gender: 'all', ageMin: 11, ageMax: 19, range: '0.5-4.30' }, { gender: 'all', ageMin: 6, ageMax: 10, range: '0.6-4.84' }, { gender: 'all', ageMin: 1, ageMax: 5, range: '0.70-5.97' }] },
  { keywords: ['ft4', 'freet4'],                       unit: 'ng/dl',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '0.78-1.55' }] },
  { keywords: ['ft3', 'freet3'],                       unit: 'pg/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '1.8-4.6' }] },
  { keywords: ['t3total', 'totalt3'],                  unit: 'ng/dl',  ranges: [{ gender: 'all', ageMin: 18, ageMax: 999, range: '0.8-2.0' }] },
  { keywords: ['t4total', 'totalt4'],                  unit: 'μg/dl',  ranges: [{ gender: 'all', ageMin: 18, ageMax: 999, range: '5.1-14.1' }] },
  { keywords: ['tpo', 'thyroidperoxidase'],            unit: 'IU/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: 'Up to 34' }] },
  { keywords: ['pth', 'parathyroid'],                  unit: 'pg/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '15-65' }] },
  { keywords: ['thyroglobulinlevel'],                  unit: 'ng/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '1.4-78.0' }] },
  { keywords: ['thyroglobulinabs'],                    unit: 'IU/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: 'Up to 115' }] },
  { keywords: ['calcitonin'],                          unit: 'pg/ml',  ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '<8.4' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '<5.0' }] },

  // ===== HORMONES - Reproductive =====
  { keywords: ['prolactin', 'برولاكتين'],              unit: 'ng/ml',  ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '3.45-17.42' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '4.60-25.07' }] },
  { keywords: ['fsh'],                                 unit: 'mIU/ml', ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '1.5-12.4' }, { gender: 'female', ageMin: 18, ageMax: 999, range: 'Follicular: 3.5-12.5 | Midcycle: 4.7-21.5 | Luteal: 1.7-7.7 | Menopausal: 25.8-134.8' }] },
  { keywords: ['lh'],                                  unit: 'mIU/ml', ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '1.7-8.6' }, { gender: 'female', ageMin: 18, ageMax: 999, range: 'Follicular: 2.4-12.6 | Midcycle: 14.0-95.6 | Luteal: 1.0-11.4 | Menopausal: 7.7-58.5' }] },
  { keywords: ['estradiol', 'betaestradiol', 'e2'],    unit: 'pg/ml',  ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '11-44' }, { gender: 'female', ageMin: 18, ageMax: 999, range: 'Follicular: 12.5-166 | Midcycle: 85.8-498 | Luteal: 43.8-211 | Menopausal: <54.7' }] },
  { keywords: ['progesterone'],                        unit: 'ng/ml',  ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '0.2-1.4' }, { gender: 'female', ageMin: 18, ageMax: 999, range: 'Follicular: 0.2-1.5 | Luteal: 1.7-27.0 | Menopausal: 0.1-0.8' }] },
  { keywords: ['testosteronetotal'],                   unit: 'ng/mL',  ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '1.66-8.11' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '0.13-1.08' }] },
  { keywords: ['testosteronefree', 'freetestosterone'], unit: 'pg/ml', ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '9.3-26.5' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '0.0-2.2' }] },
  { keywords: ['shbg', 'sexhormonebinding'],           unit: 'nmol/L', ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '18.3-54.1' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '24.6-122.0' }] },
  { keywords: ['dheas', 'dehydroepiandrosterone'],     unit: 'μg/dl',  ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '80-560' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '35-430' }] },
  { keywords: ['cortisol'],                            unit: 'μg/dL',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: 'Morning: 6.2-19.4 | Evening: 2.3-11.9' }], exclude: ['urine', 'free', 'stimul'] },
  { keywords: ['acth'],                                unit: 'pg/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: 'Morning: 7.2-63.3' }] },
  { keywords: ['growthhormone', 'gh'],                 unit: 'ng/ml',  ranges: [{ gender: 'all', ageMin: 18, ageMax: 999, range: '<5' }], exclude: ['stimul', 'suppres'] },
  { keywords: ['igf1', 'insulinlikegrowth'],           unit: 'ng/ml',  ranges: [{ gender: 'all', ageMin: 20, ageMax: 29, range: '127-424' }, { gender: 'all', ageMin: 30, ageMax: 39, range: '101-267' }, { gender: 'all', ageMin: 40, ageMax: 49, range: '78-200' }, { gender: 'all', ageMin: 50, ageMax: 999, range: '55-166' }] },
  { keywords: ['antimullerianhormon', 'amh'],          unit: 'ng/ml',  ranges: [{ gender: 'female', ageMin: 25, ageMax: 29, range: '3.0-6.8' }, { gender: 'female', ageMin: 30, ageMax: 34, range: '2.1-6.8' }, { gender: 'female', ageMin: 35, ageMax: 39, range: '1.2-5.0' }, { gender: 'female', ageMin: 40, ageMax: 44, range: '0.4-3.5' }, { gender: 'female', ageMin: 45, ageMax: 999, range: '<1.0' }] },
  { keywords: ['erythropoietin', 'epo'],               unit: 'mIU/ml', ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '4.3-29.0' }] },

  // ===== HORMONES - HCG =====
  { keywords: ['bhcgquantitative', 'hcgquantitative'], unit: 'mIU/ml', ranges: [{ gender: 'female', ageMin: 0, ageMax: 999, range: 'Non-pregnant: <5' }] },

  // ===== TUMOR MARKERS =====
  { keywords: ['afp', 'alphafetoprotein'],             unit: 'ng/ml',  ranges: [{ gender: 'all', ageMin: 18, ageMax: 999, range: '<10' }] },
  { keywords: ['cea'],                                 unit: 'ng/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: 'Non-smoker: <3.0 | Smoker: <5.0' }] },
  { keywords: ['ca125'],                               unit: 'U/ml',   ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<35' }] },
  { keywords: ['ca153', 'ca15'],                       unit: 'U/ml',   ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<25' }] },
  { keywords: ['ca199', 'ca19'],                       unit: 'U/ml',   ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<37' }] },
  { keywords: ['ca724', 'ca72'],                       unit: 'U/ml',   ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<6.9' }] },
  { keywords: ['psatotal'],                            unit: 'ng/ml',  ranges: [{ gender: 'male', ageMin: 0, ageMax: 39, range: 'Up to 1.4' }, { gender: 'male', ageMin: 40, ageMax: 49, range: 'Up to 2.0' }, { gender: 'male', ageMin: 50, ageMax: 59, range: 'Up to 3.1' }, { gender: 'male', ageMin: 60, ageMax: 69, range: 'Up to 4.1' }, { gender: 'male', ageMin: 70, ageMax: 999, range: 'Up to 4.4' }] },
  { keywords: ['psafree'],                             unit: 'ng/ml',  ranges: [{ gender: 'male', ageMin: 0, ageMax: 999, range: 'Ratio free/total >25%' }] },

  // ===== IMMUNOLOGY =====
  { keywords: ['crp'],                                 unit: 'mg/L',   ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<6.0' }] },
  { keywords: ['rf', 'rheumatoidfactor'],              unit: 'IU/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<14.0' }] },
  { keywords: ['asot', 'aso'],                         unit: 'IU/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<200' }] },
  { keywords: ['esr'],                                 unit: 'mm/hr',  ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '0-15' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '0-20' }] },
  { keywords: ['c3complement'],                        unit: 'mg/dL',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '90-180' }] },
  { keywords: ['c4complement'],                        unit: 'mg/dL',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '10-40' }] },
  { keywords: ['iga'],                                 unit: 'mg/dL',  ranges: [{ gender: 'all', ageMin: 18, ageMax: 999, range: '70-400' }], exclude: ['anti', 'abs'] },
  { keywords: ['igg'],                                 unit: 'mg/dL',  ranges: [{ gender: 'all', ageMin: 18, ageMax: 999, range: '700-1600' }], exclude: ['anti', 'abs', 'subclass'] },
  { keywords: ['igm'],                                 unit: 'mg/dL',  ranges: [{ gender: 'all', ageMin: 18, ageMax: 999, range: '40-230' }], exclude: ['anti', 'abs'] },
  { keywords: ['ige'],                                 unit: 'IU/ml',  ranges: [{ gender: 'all', ageMin: 18, ageMax: 999, range: '<100' }], exclude: ['anti', 'abs'] },
  { keywords: ['haptoglobin'],                         unit: 'mg/dL',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '30-200' }] },
  { keywords: ['homocysteine'],                        unit: 'μmol/L', ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '5-15' }] },

  // ===== COAGULATION =====
  { keywords: ['pt'],                                  unit: 'seconds', ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '11-13.5' }], exclude: ['pth', 'parathyroid'] },
  { keywords: ['aptt', 'ptt'],                         unit: 'seconds', ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '25-35' }] },
  { keywords: ['fibrinogen'],                          unit: 'mg/dL',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '200-400' }] },
  { keywords: ['ddimer'],                              unit: 'ng/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<500' }] },

  // ===== CARDIAC =====
  { keywords: ['ck', 'creatinekinase'],                unit: 'U/L',    ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '39-308' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '26-192' }], exclude: ['ckmb', 'mb'] },
  { keywords: ['ckmb'],                                unit: 'U/L',    ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<24' }] },
  { keywords: ['troponin'],                            unit: 'ng/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '<0.04' }] },

  // ===== VITAMINS =====
  { keywords: ['ferritin', 'فيريتين'],                 unit: 'ng/ml',  ranges: [{ gender: 'male', ageMin: 18, ageMax: 999, range: '30-400' }, { gender: 'female', ageMin: 18, ageMax: 999, range: '12-150' }] },
  { keywords: ['vitaminb12', 'b12'],                   unit: 'pg/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '200-900' }] },
  { keywords: ['vitamind', 'vitd', '25ohvitamin'],     unit: 'ng/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '30.0-100.0' }] },
  { keywords: ['folate', 'folicacid'],                 unit: 'ng/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '3.1-20.5' }] },

  // ===== COMPLEMENT =====
  { keywords: ['c3complement', 'complementc3', 'c3'],   unit: 'mg/dL',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '90-180' }] },
  { keywords: ['c4complement', 'complementc4', 'c4'],   unit: 'mg/dL',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '10-40' }] },

  // ===== DRUG LEVELS =====
  { keywords: ['lithium'],                             unit: 'mEq/L',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '0.6-1.2' }] },
  { keywords: ['valproicacid', 'valproate', 'valproricacid', 'valporic'], unit: 'μg/ml', ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '50-100' }] },
  { keywords: ['phenobarbital', 'luminal'],            unit: 'μg/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '15-40' }] },
  { keywords: ['carbamazepine', 'carbamizapine', 'tegretol'], unit: 'μg/ml', ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '4-12' }] },
  { keywords: ['phenytoin', 'phynitoin', 'epanutin', 'dilantin'], unit: 'μg/ml', ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '10-20' }] },
  { keywords: ['cyclosporine'],                        unit: 'ng/ml',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: '100-400' }] },

  // ===== COMBINED BLOOD SUGAR =====
  { keywords: ['fbgorrbgorppbg', 'fbgrbg'],            unit: 'mg/dl',  ranges: [{ gender: 'all', ageMin: 0, ageMax: 999, range: 'FBG: 70-100 | RBG: <140 | PPBG: <140' }] },

  // ===== CBC - handled separately =====
  { keywords: ['cbc', 'completebloodcount', 'صورةدم'], unit: '',      ranges: [] },
];

// Helper: normalize name for matching
const normalizeName = (name) => {
  return (name || '').toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/g, '');
};

// Find matching reference entry for a test name
const findReference = (testName) => {
  const normalized = normalizeName(testName);
  for (const ref of REFERENCE_DB) {
    // Check exclude list
    if (ref.exclude && ref.exclude.some(ex => normalized.includes(ex))) continue;
    // Check keywords
    if (ref.keywords.some(kw => normalized.includes(normalizeName(kw)))) {
      return ref;
    }
  }
  return null;
};

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  // تشغيل على كل الفحوصات (إعادة تحديث المحدّثة مسبقاً أيضاً)
  const tests = await MedicalTest.find({});
  console.log(`📋 Found ${tests.length} tests`);

  let updated = 0;
  let skipped = 0;
  let noMatch = 0;

  for (const test of tests) {
    const ref = findReference(test.name);
    if (!ref) {
      console.log(`  ⚪ No reference found: ${test.name}`);
      noMatch++;
      continue;
    }

    if (ref.ranges.length === 0) {
      console.log(`  ⏭️  Skipping (structured form): ${test.name}`);
      skipped++;
      continue;
    }

    // Build normalRanges array
    const normalRanges = ref.ranges.map(r => ({
      gender: r.gender || 'all',
      ageMin: r.ageMin !== undefined ? r.ageMin : 0,
      ageMax: r.ageMax !== undefined ? r.ageMax : 999,
      range: r.range,
      unit: ref.unit || test.unit || '',
    }));

    await MedicalTest.updateOne(
      { _id: test._id },
      {
        $set: {
          normalRanges,
          unit: test.unit || ref.unit || '',
        }
      }
    );

    console.log(`  ✅ Updated: ${test.name} → ${normalRanges.length} range(s)`);
    updated++;
  }

  console.log('\n========== SUMMARY ==========');
  console.log(`✅ Updated:  ${updated}`);
  console.log(`⏭️  Skipped:  ${skipped}`);
  console.log(`⚪ No match: ${noMatch}`);
  console.log(`📋 Total:    ${tests.length}`);

  await mongoose.disconnect();
  console.log('\n✅ Done.');
}

run().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
