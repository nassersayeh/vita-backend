const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 10000 });
  const Drug = require('../models/Drug');
  const fields = ['name', 'genericName', 'description', 'imageUrl', 'externalDescription', 'metadataStatus', 'metadataSource', 'category', 'manufacturer', 'dosageForm', 'strength', 'activeIngredients', 'contraindications', 'sideEffects', 'itemId', 'barcode', 'unitSellingPrice', 'sellingPriceCurrency', 'isActive', 'isCustom', 'ownerPharmacyId'];
  const rows = await Drug.collection.find({}, { projection: Object.fromEntries(fields.map(field => [field, 1])) }).toArray();
  const out = path.resolve(__dirname, '../../tmp/paldose-audit/vita-catalog-snapshot.json');
  fs.writeFileSync(out, JSON.stringify({ capturedAt: new Date().toISOString(), rows }));
  const central = rows.filter(row => !row.isCustom && !row.ownerPharmacyId);
  const active = central.filter(row => row.isActive !== false);
  const present = value => Array.isArray(value) ? value.some(present) : value != null && String(value).trim() !== '';
  console.log(JSON.stringify({ total: rows.length, central: central.length, activeCentral: active.length, pharmacyCustom: rows.length - central.length, fieldCoverage: Object.fromEntries(fields.filter(field => !['ownerPharmacyId','description','externalDescription'].includes(field)).map(field => [field, active.filter(row => present(row[field])).length])), samples: active.slice(0, 12).map(({ name, genericName, manufacturer, dosageForm, strength, unitSellingPrice }) => ({ name, genericName, manufacturer, dosageForm, strength, unitSellingPrice })) }, null, 2));
}
main().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
