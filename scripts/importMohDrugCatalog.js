/**
 * Import the Palestinian MOH registered-products and EDL catalogs, enrich exact
 * name matches with the official price list, then ensure every pharmacy has 10.
 *
 * Dry run: node scripts/importMohDrugCatalog.js
 * Apply:   node scripts/importMohDrugCatalog.js --apply
 */
require('dotenv').config();
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');

const Drug = require('../models/Drug');
const User = require('../models/User');
const PharmacyInventory = require('../models/PharmacyInventory');

const BASE_URL = 'https://pharmacy.moh.ps';
// The legacy MOH DataTables endpoints accept a large page and return the full
// catalog more reliably than paging (EDL otherwise drops rows near the end).
const PAGE_SIZE = 20000;
const BATCH_SIZE = 500;
const APPLY = process.argv.includes('--apply');
const CACHE_PATH = process.env.MOH_IMPORT_CACHE || path.join(os.tmpdir(), 'vita-moh-drug-catalog.json');

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 120000,
  // The ministry server currently sends an incomplete certificate chain.
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  headers: { 'User-Agent': 'Vita-MOH-Catalog-Importer/1.0 (gdp@moh.ps public data)' },
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const stripHtml = (value = '') => String(value)
  .replace(/<br\s*\/?>/gi, ' > ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim();

const normalizeName = (value = '') => stripHtml(value)
  .toLowerCase()
  .normalize('NFKC')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const numberOrZero = (value) => {
  const parsed = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

async function fetchDataTable(endpoint, label) {
  const rows = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const response = await http.get(endpoint, {
      params: {
        sEcho: Math.floor(offset / PAGE_SIZE) + 1,
        iDisplayStart: offset,
        iDisplayLength: PAGE_SIZE,
        sSearch: '',
        param1: 0,
        param2: 0,
        param3: 'ar',
        param4: 0,
      },
    });
    const page = Array.isArray(response.data?.aaData) ? response.data.aaData : [];
    total = Number(response.data?.iTotalDisplayRecords || page.length);
    rows.push(...page);
    offset += page.length;
    console.log(`${label}: ${rows.length}/${total}`);
    if (page.length === 0) break;
    await sleep(250);
  }
  return rows;
}

function buildPriceMap(rows) {
  const prices = new Map();
  for (const row of rows) {
    const name = stripHtml(row[0]);
    if (!name) continue;
    prices.set(normalizeName(name), {
      price: numberOrZero(row[2]),
      genericName: stripHtml(row[1]),
      pack: stripHtml(row[3]),
      supplier: stripHtml(row[4]),
    });
  }
  return prices;
}

function mapRegistered(rows, priceMap) {
  return rows.map(row => {
    const name = stripHtml(row[0]);
    const price = priceMap.get(normalizeName(name));
    const manufacturer = stripHtml(row[1]);
    const dosageForm = stripHtml(row[2]);
    const productCategory = stripHtml(row[3]);
    const origin = stripHtml(row[4]);
    return {
      name,
      genericName: price?.genericName || '',
      description: [
        productCategory && `التصنيف: ${productCategory}`,
        origin && `المنشأ: ${origin}`,
        dosageForm && `الشكل الصيدلاني: ${dosageForm}`,
        price?.pack && `التعبئة: ${price.pack}`,
      ].filter(Boolean).join(' | '),
      category: productCategory || 'Registered Product',
      manufacturer,
      mainSupplier: price?.supplier || '',
      dosageForm,
      unitSellingPrice: price?.price || 0,
      sellingPriceCurrency: 'شيقل',
      metadataSource: 'Palestinian MOH Registered Products',
      metadataStatus: 'fetched',
      metadataFetchedAt: new Date(),
      isActive: true,
    };
  }).filter(item => item.name);
}

function mapEdl(rows, priceMap) {
  return rows.map(row => {
    const itemId = stripHtml(row[0]);
    const name = stripHtml(row[1]);
    const strength = stripHtml(row[2]);
    const category = stripHtml(row[3]);
    const price = priceMap.get(normalizeName(name));
    return {
      name,
      genericName: name,
      itemId: itemId || undefined,
      description: [
        'مدرج في قائمة الأدوية الأساسية الفلسطينية (EDL)',
        category && `التصنيف العلاجي: ${category}`,
        strength && `التركيز/الشكل: ${strength}`,
      ].filter(Boolean).join(' | '),
      category: category || 'Essential Drug List (EDL)',
      strength,
      unitSellingPrice: price?.price || 0,
      mainSupplier: price?.supplier || '',
      sellingPriceCurrency: 'شيقل',
      metadataSource: 'Palestinian MOH EDL',
      metadataStatus: 'fetched',
      metadataFetchedAt: new Date(),
      isActive: true,
    };
  }).filter(item => item.name);
}

async function bulkInsertNewDrugs(candidates) {
  const existing = await Drug.find({}, 'name genericName itemId').lean();
  const existingNames = new Set();
  const existingByName = new Map();
  const existingItemIds = new Set();
  const existingByItemId = new Map();
  for (const drug of existing) {
    if (drug.name) {
      existingNames.add(normalizeName(drug.name));
      existingByName.set(normalizeName(drug.name), drug._id);
    }
    if (drug.genericName) {
      existingNames.add(normalizeName(drug.genericName));
      existingByName.set(normalizeName(drug.genericName), drug._id);
    }
    if (drug.itemId) {
      existingItemIds.add(String(drug.itemId).trim().toLowerCase());
      existingByItemId.set(String(drug.itemId).trim().toLowerCase(), drug._id);
    }
  }

  const seen = new Set(existingNames);
  const newDrugs = [];
  const catalogIds = new Set();
  let skipped = 0;
  for (const drug of candidates) {
    const key = normalizeName(drug.name);
    const itemKey = drug.itemId ? String(drug.itemId).trim().toLowerCase() : '';
    if (!key || seen.has(key) || (itemKey && existingItemIds.has(itemKey))) {
      const existingId = existingByName.get(key) || existingByItemId.get(itemKey);
      if (existingId) catalogIds.add(String(existingId));
      skipped += 1;
      continue;
    }
    seen.add(key);
    if (itemKey) existingItemIds.add(itemKey);
    newDrugs.push(drug);
  }

  console.log(`New drugs: ${newDrugs.length}; skipped existing/duplicates: ${skipped}`);
  if (!APPLY || newDrugs.length === 0) return { newDrugs, catalogIds: [...catalogIds] };

  const insertedIds = [];
  for (let index = 0; index < newDrugs.length; index += BATCH_SIZE) {
    const inserted = await Drug.insertMany(newDrugs.slice(index, index + BATCH_SIZE), { ordered: false });
    insertedIds.push(...inserted.map(drug => drug._id));
    console.log(`Inserted drugs: ${insertedIds.length}/${newDrugs.length}`);
  }
  insertedIds.forEach(id => catalogIds.add(String(id)));
  return { newDrugs, catalogIds: [...catalogIds] };
}

async function ensurePharmacyInventory(importedDrugIds) {
  const pharmacies = await User.find({ role: 'Pharmacy' }, '_id fullName').lean();
  const importedDrugs = await Drug.find({ _id: { $in: importedDrugIds } }).lean();
  console.log(`Pharmacies: ${pharmacies.length}; imported drugs for inventory: ${importedDrugs.length}`);
  if (!APPLY) return;

  for (const pharmacy of pharmacies) {
    const completedItems = await PharmacyInventory.countDocuments({
      pharmacyId: pharmacy._id,
      drugId: { $in: importedDrugIds },
      quantity: 10,
      isActive: true,
    });
    if (completedItems === importedDrugs.length) {
      console.log(`Inventory ${pharmacy.fullName}: already complete, skipped`);
      continue;
    }
    let processed = 0;
    for (let index = 0; index < importedDrugs.length; index += BATCH_SIZE) {
      const operations = importedDrugs.slice(index, index + BATCH_SIZE).map(drug => ({
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
      await PharmacyInventory.bulkWrite(operations, { ordered: false });
      processed += operations.length;
    }
    console.log(`Inventory ${pharmacy.fullName}: ${processed} drugs set to quantity 10`);
  }
}

async function main() {
  console.log(APPLY ? 'APPLY MODE' : 'DRY RUN (pass --apply to write)');
  let sourceData;
  if (fs.existsSync(CACHE_PATH)) {
    sourceData = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    console.log(`Using source cache: ${CACHE_PATH}`);
  } else {
    const [registeredRows, edlRows, priceRows] = await Promise.all([
      fetchDataTable('/service/getRegisterProducts', 'Registered'),
      fetchDataTable('/service/getDrugs', 'EDL'),
      fetchDataTable('/service/getDrugsPublic', 'Prices'),
    ]);
    sourceData = { registeredRows, edlRows, priceRows, fetchedAt: new Date().toISOString() };
    fs.writeFileSync(CACHE_PATH, JSON.stringify(sourceData));
    console.log(`Saved source cache: ${CACHE_PATH}`);
  }
  const { registeredRows, edlRows, priceRows } = sourceData;
  const priceMap = buildPriceMap(priceRows);
  const candidates = [...mapRegistered(registeredRows, priceMap), ...mapEdl(edlRows, priceMap)];
  console.log(`MOH candidates: ${candidates.length}; official prices: ${priceMap.size}`);

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(mongoUri);
  console.log(`Connected to MongoDB database: ${mongoose.connection.name}`);
  const { catalogIds } = await bulkInsertNewDrugs(candidates);
  await ensurePharmacyInventory(catalogIds);
  await mongoose.disconnect();
  console.log(APPLY ? 'Import completed.' : 'Dry run completed; no database changes were made.');
}

main().catch(async error => {
  console.error('MOH import failed:', error.response?.data || error.message || error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
