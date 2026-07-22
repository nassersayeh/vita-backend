/**
 * Import English drug data from the Israeli Ministry of Health public registry.
 * Existing Vita drugs are skipped by normalized English name or registration ID.
 *
 * Dry run: node scripts/importIsraelDrugCatalog.js
 * Apply:   node scripts/importIsraelDrugCatalog.js --apply
 */
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');

const Drug = require('../models/Drug');
const User = require('../models/User');
const PharmacyInventory = require('../models/PharmacyInventory');

const APPLY = process.argv.includes('--apply');
const API_URL = 'https://israeldrugs.health.gov.il/GovServiceList/IDRServer/SearchByName';
const CACHE_PATH = process.env.ISRAEL_DRUG_IMPORT_CACHE || path.join(os.tmpdir(), 'vita-israel-drug-catalog.json');
const CONCURRENCY = 5;
const BATCH_SIZE = 500;

const http = axios.create({
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'Vita Drug Registry Importer/1.0',
  },
});

const normalize = (value = '') => String(value)
  .toLowerCase()
  .normalize('NFKC')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const clean = (value = '') => String(value).replace(/\s+/g, ' ').trim();
const containsHebrew = (value = '') => /[\u0590-\u05FF]/.test(String(value));
const parsePrice = (...values) => {
  for (const value of values) {
    const number = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};

const dosageFormTranslations = new Map([
  ['טבליה', 'Tablet'],
  ['טבליות', 'Tablets'],
  ['טבליות מצופות', 'Coated tablets'],
  ['טבליות מצופות פילם', 'Film-coated tablets'],
  ['כמוסה', 'Capsule'],
  ['כמוסות', 'Capsules'],
  ['סירופ', 'Syrup'],
  ['תרחיף', 'Suspension'],
  ['תמיסה', 'Solution'],
  ['תמיסה להזרקה', 'Solution for injection'],
  ['אבקה להכנת תמיסה להזרקה', 'Powder for solution for injection'],
  ['משחה', 'Ointment'],
  ['קרם', 'Cream'],
  ['ג׳ל', 'Gel'],
  ['ג\'ל', 'Gel'],
  ['טיפות עיניים', 'Eye drops'],
  ['טיפות אף', 'Nasal drops'],
  ['טיפות אוזניים', 'Ear drops'],
  ['תרסיס לאף', 'Nasal spray'],
  ['תרסיס', 'Spray'],
  ['פתילה', 'Suppository'],
  ['פתילות', 'Suppositories'],
  ['מדבקה', 'Transdermal patch'],
  ['משאף', 'Inhaler'],
]);

function translateDosageForm(value) {
  const cleaned = clean(value);
  return dosageFormTranslations.get(cleaned) || (containsHebrew(cleaned) ? '' : cleaned);
}

async function fetchPage(pageIndex, attempt = 1) {
  try {
    const response = await http.post(API_URL, {
      // The registry returns its full catalog for this broad English query.
      val: 'a',
      prescription: false,
      healthServices: false,
      pageIndex,
      orderBy: 1,
    });
    return response.data;
  } catch (error) {
    if (attempt >= 4) throw error;
    await new Promise(resolve => setTimeout(resolve, attempt * 1500));
    return fetchPage(pageIndex, attempt + 1);
  }
}

async function fetchCatalog() {
  if (fs.existsSync(CACHE_PATH)) {
    const cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    const expectedRows = Number(cached.results?.[0]?.results || 0);
    if (cached.results?.length > 10 && (!expectedRows || cached.results.length >= expectedRows)) {
      console.log(`Using source cache: ${CACHE_PATH}`);
      return cached.results;
    }
    console.log(`Ignoring incomplete source cache: ${CACHE_PATH}`);
  }

  const first = await fetchPage(1);
  const totalPages = Number(first.pages || first.results?.[0]?.pages || 1);
  const all = [...(first.results || [])];
  let nextPage = 2;
  let completed = 1;

  async function worker() {
    while (nextPage <= totalPages) {
      const page = nextPage++;
      const response = await fetchPage(page);
      all.push(...(response.results || []));
      completed += 1;
      if (completed % 25 === 0 || completed === totalPages) {
        console.log(`Registry pages: ${completed}/${totalPages}; rows: ${all.length}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const byRegistration = new Map();
  for (const row of all) {
    if (!row?.dragRegNum || !row?.dragEnName) continue;
    byRegistration.set(clean(row.dragRegNum), row);
  }
  const results = [...byRegistration.values()];
  fs.writeFileSync(CACHE_PATH, JSON.stringify({ fetchedAt: new Date().toISOString(), results }));
  console.log(`Saved ${results.length} unique registry rows to ${CACHE_PATH}`);
  return results;
}

function mapDrug(row) {
  const activeIngredients = (row.activeComponents || [])
    .map(component => clean(component.componentName))
    .filter(Boolean);
  const name = clean(row.dragEnName);
  const registration = clean(row.dragRegNum);
  const price = parsePrice(row.customerPrice, row.singlePrice, ...(row.packagesPrices || []));
  const dosageForm = translateDosageForm(row.dosageForm);
  const rawRoute = clean(row.route);
  const route = containsHebrew(rawRoute) ? '' : rawRoute;

  return {
    name,
    genericName: clean(row.activeComponentsCompareName || activeIngredients.join(', ')),
    description: clean(row.indications),
    itemId: `IL-${registration.replace(/\s+/g, '-')}`,
    barcode: clean(row.barcodes) || undefined,
    category: row.prescription ? 'Prescription Medicine' : 'Non-prescription Medicine',
    manufacturer: clean(row.dragRegOwner),
    dosageForm,
    strength: clean(row.activeComponentsDisplayName),
    activeIngredients,
    unitSellingPrice: price,
    sellingPriceCurrency: 'ILS',
    lastUpdateDate: row.dragRegDate ? new Date(row.dragRegDate.split('.').reverse().join('-')) : undefined,
    metadataSource: 'Israeli Ministry of Health Drug Registry',
    metadataStatus: 'fetched',
    metadataFetchedAt: new Date(),
    externalDescription: [route && `Route: ${route}`, row.health && 'Included in health services basket'].filter(Boolean).join(' | '),
    isActive: !row.iscanceled,
  };
}

async function selectNewDrugs(candidates) {
  const existing = await Drug.find({}, 'name genericName itemId').lean();
  const names = new Set();
  const itemIds = new Set();
  for (const drug of existing) {
    if (drug.name) names.add(normalize(drug.name));
    if (drug.genericName) names.add(normalize(drug.genericName));
    if (drug.itemId) itemIds.add(normalize(drug.itemId));
  }

  const selected = [];
  let skipped = 0;
  for (const drug of candidates) {
    const nameKey = normalize(drug.name);
    const itemKey = normalize(drug.itemId);
    if (!nameKey || names.has(nameKey) || itemIds.has(itemKey)) {
      skipped += 1;
      continue;
    }
    names.add(nameKey);
    itemIds.add(itemKey);
    selected.push(drug);
  }
  console.log(`New English drugs: ${selected.length}; skipped duplicates: ${skipped}`);
  return selected;
}

async function insertDrugs(drugs) {
  if (!APPLY || drugs.length === 0) return [];
  const ids = [];
  for (let index = 0; index < drugs.length; index += BATCH_SIZE) {
    const inserted = await Drug.insertMany(drugs.slice(index, index + BATCH_SIZE), { ordered: false });
    ids.push(...inserted.map(drug => drug._id));
    console.log(`Inserted: ${ids.length}/${drugs.length}`);
  }
  return ids;
}

async function addToPharmacies(drugIds) {
  if (!APPLY || drugIds.length === 0) return;
  const [pharmacies, drugs] = await Promise.all([
    User.find({ role: 'Pharmacy' }, '_id fullName').lean(),
    Drug.find({ _id: { $in: drugIds } }).lean(),
  ]);
  for (const pharmacy of pharmacies) {
    const operations = drugs.map(drug => ({
      updateOne: {
        filter: { pharmacyId: pharmacy._id, drugId: drug._id },
        update: {
          $set: {
            drugName: drug.name,
            drugGenericName: drug.genericName || '',
            quantity: 10,
            price: Number(drug.unitSellingPrice || 0),
            currency: 'ILS',
            isAvailable: true,
            isActive: true,
            lastRestockDate: new Date(),
          },
          $setOnInsert: { minimumStock: 5, soldCount: 0 },
        },
        upsert: true,
      },
    }));
    for (let index = 0; index < operations.length; index += BATCH_SIZE) {
      await PharmacyInventory.bulkWrite(operations.slice(index, index + BATCH_SIZE), { ordered: false });
    }
    console.log(`Inventory ${pharmacy.fullName}: ${drugs.length} new drugs at quantity 10`);
  }
}

async function main() {
  console.log(APPLY ? 'APPLY MODE' : 'DRY RUN');
  const sourceRows = await fetchCatalog();
  const candidates = sourceRows.map(mapDrug).filter(drug => drug.name && drug.isActive);
  console.log(`Active English candidates: ${candidates.length}`);

  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to MongoDB database: ${mongoose.connection.name}`);
  const newDrugs = await selectNewDrugs(candidates);
  const insertedIds = await insertDrugs(newDrugs);
  await addToPharmacies(insertedIds);
  await mongoose.disconnect();
  console.log(APPLY ? 'Israeli registry import completed.' : 'Dry run complete; no database writes.');
}

main().catch(async error => {
  console.error('Israeli registry import failed:', error.response?.data || error.message || error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
