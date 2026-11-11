const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const present = value => Array.isArray(value) ? value.some(present) : value != null && !/^(?:\s*|null|undefined|n\/?a|unknown|not available|not specified|[-–—])$/i.test(String(value).trim());
const validPrice = value => value != null && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value)) && Number(value) >= 0;
const exactKey = name => String(name || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
function nameKey(name) {
  return exactKey(name)
    .replace(/(\d)(?=(?:MCG|MG|ML|GM|IU)\b)/g, '$1 ')
    .replace(/\b(TABLETS?|TABS?)\b/g, 'TAB').replace(/\b(CAPSULES?|CAPS?)\b/g, 'CAP')
    .replace(/\b(SYRUPS?|SYP)\b/g, 'SYRUP').replace(/\b(INJECTIONS?|INJ)\b/g, 'INJ')
    .replace(/\b(CREAMS?|CRM)\b/g, 'CREAM').replace(/\b(OINTMENTS?|OINT)\b/g, 'OINT')
    .replace(/[^\p{L}\p{N}.%+/]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
const brandKey = name => nameKey(name).split(' ')[0].replace(/\d.*$/, '');
const coverage = (rows, field) => rows.filter(row => present(row[field])).length;
const add = (map, key, row) => { if (key) map.set(key, [...(map.get(key) || []), row]); };
function index(rows, keyFn) { const result = new Map(); rows.forEach(row => add(result, keyFn(row.name), row)); return result; }
function classify(source, indexes) {
  const name = source['Commercial Name'];
  const exact = indexes.exact.get(exactKey(name)) || [];
  if (exact.length) return { status: exact.length === 1 ? 'confirmed_exact' : 'ambiguous', candidates: exact };
  const normalized = indexes.normalized.get(nameKey(name)) || [];
  if (normalized.length) return { status: normalized.length === 1 ? 'confirmed_normalized' : 'ambiguous', candidates: normalized };
  const tokens = new Set(nameKey(name).split(' '));
  const nearby = (indexes.brands.get(brandKey(name)) || []).map(row => {
    const candidateTokens = new Set(nameKey(row.name).split(' '));
    const intersection = [...tokens].filter(token => candidateTokens.has(token)).length;
    return { row, score: intersection / (tokens.size + candidateTokens.size - intersection) };
  }).sort((a, b) => b.score - a.score).filter(candidate => candidate.score >= 0.25).slice(0, 5);
  return { status: nearby.length ? 'review_similar' : 'no_candidate', candidates: nearby.map(candidate => candidate.row) };
}

function run() {
  const root = path.resolve(__dirname, '../..');
  const input = path.join(root, 'tmp/paldose-audit');
  const output = path.join(root, 'reports/paldose-audit-2026-11-08');
  fs.mkdirSync(output, { recursive: true });
  const source = JSON.parse(fs.readFileSync(path.join(input, 'source-core.json'), 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(path.join(input, 'vita-catalog-snapshot.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(input, 'source-manifest.json'), 'utf8'));
  const central = snapshot.rows.filter(row => !row.isCustom && !row.ownerPharmacyId);
  const active = central.filter(row => row.isActive !== false);
  const indexes = { exact: index(active, exactKey), normalized: index(active, nameKey), brands: index(active, brandKey) };
  const inactiveIndexes = { exact: index(central.filter(row => row.isActive === false), exactKey), normalized: index(central.filter(row => row.isActive === false), nameKey), brands: new Map() };
  const factual = source.map(row => ({
    source_id: row['Product ID'], commercial_name: row['Commercial Name'], scientific_name: row['Sci Name'],
    commercial_ar_aliases: row['Commercial Name AR'], scientific_ar_aliases: row['Sci Name AR'],
    company: row.Company, dosage_form: row['Verified Dosage Form'], pack_size: row.Size,
    listed_price: validPrice(row.Price3) ? Number(row.Price3) : null,
    source_url: 'https://www.paldose.help/',
  }));
  const matches = [], gaps = [], differences = [], review = [], noCandidate = [];
  const matchedVitaIds = new Set();
  const mappings = [
    ['scientific_name', 'Sci Name', 'genericName'], ['company', 'Company', 'manufacturer'],
    ['dosage_form', 'Verified Dosage Form', 'dosageForm'],
    ['selling_price', 'Price3', 'unitSellingPrice'],
  ];
  for (let i = 0; i < source.length; i++) {
    const external = source[i], fact = factual[i], result = classify(external, indexes);
    const confirmed = result.status.startsWith('confirmed_');
    const local = confirmed ? result.candidates[0] : null;
    const row = { source_id: fact.source_id, source_name: fact.commercial_name, status: result.status, source_scientific_name: fact.scientific_name, source_company: fact.company, source_form: fact.dosage_form, source_pack: fact.pack_size, source_price: fact.listed_price,
      vita_id: local ? String(local._id) : '', vita_name: local?.name || '', vita_generic_name: local?.genericName || '', vita_company: local?.manufacturer || '', vita_form: local?.dosageForm || '', vita_strength: local?.strength || '', vita_price: local?.unitSellingPrice ?? '',
      candidate_count: result.candidates.length, candidate_names: result.candidates.map(candidate => candidate.name).join(' | '), candidate_ids: result.candidates.map(candidate => String(candidate._id)).join(' | ') };
    matches.push(row);
    if (!confirmed) {
      const inactive = classify(external, inactiveIndexes);
      row.inactive_match = inactive.status.startsWith('confirmed_') ? String(inactive.candidates[0]._id) : '';
      if (result.status === 'no_candidate') noCandidate.push(row); else review.push(row);
      continue;
    }
    matchedVitaIds.add(String(local._id));
    const missing = mappings.filter(([, externalField, field]) => (field === 'unitSellingPrice' ? validPrice(external[externalField]) && !validPrice(local[field]) : present(external[externalField]) && !present(local[field]))).map(([label]) => label);
    // Clinical prose is intentionally NOT copied into the comparison export.
    if (present(external.Contraindications) && !present(local.contraindications)) missing.push('contraindications');
    if (!present(local.activeIngredients) && present(external['Sci Name'])) missing.push('active_ingredients_structured_review_required');
    if (!present(local.strength)) missing.push('structured_strength_review_required');
    if (missing.length) gaps.push({ source_id: fact.source_id, source_name: fact.commercial_name, vita_id: row.vita_id, vita_name: local.name, missing_fields: missing.join(' | ') });
    if (validPrice(local.unitSellingPrice) && fact.listed_price != null && Math.abs(Number(local.unitSellingPrice) - fact.listed_price) > 0.009) differences.push({ source_id: fact.source_id, source_name: fact.commercial_name, vita_id: row.vita_id, vita_name: local.name, source_pack: fact.pack_size, paldose_price: fact.listed_price, vita_price: local.unitSellingPrice, vita_currency: local.sellingPriceCurrency || '', difference: Math.round((fact.listed_price - Number(local.unitSellingPrice)) * 100) / 100, note: 'Review package size, source currency and price date before treating as a price conflict.' });
  }
  const counts = Object.fromEntries(['confirmed_exact', 'confirmed_normalized', 'ambiguous', 'review_similar', 'no_candidate'].map(status => [status, matches.filter(row => row.status === status).length]));
  const matched = matches.filter(row => row.status.startsWith('confirmed_'));
  const missingCounts = {};
  gaps.forEach(row => row.missing_fields.split(' | ').forEach(field => { missingCounts[field] = (missingCounts[field] || 0) + 1; }));
  const localCoverage = ['genericName', 'manufacturer', 'dosageForm', 'strength', 'activeIngredients', 'contraindications', 'sideEffects', 'barcode', 'unitSellingPrice', 'description', 'imageUrl'].map(field => ({ field, present: field === 'unitSellingPrice' ? active.filter(row => validPrice(row[field])).length : coverage(active, field), total: active.length, missing: field === 'unitSellingPrice' ? active.filter(row => !validPrice(row[field])).length : active.length - coverage(active, field) }));
  const sourcePresence = [...new Set(source.flatMap(Object.keys))].filter(field => !field.startsWith('__')).map(field => ({ field, present: field === 'Price3' ? source.filter(row => validPrice(row[field])).length : coverage(source, field), total: source.length }));
  const sourceNames = new Map();
  for (const row of source) add(sourceNames, exactKey(row['Commercial Name']), row);
  const sourceDuplicates = [...sourceNames.values()].filter(rows => rows.length > 1).flatMap(rows => rows.map(row => ({ source_id: row['Product ID'], name: row['Commercial Name'], pack_size: row.Size, price: row.Price3, same_name_rows: rows.length })));
  const localNotMatched = active.filter(row => !matchedVitaIds.has(String(row._id))).map(row => ({ vita_id: String(row._id), name: row.name, generic_name: row.genericName || '', manufacturer: row.manufacturer || '', dosage_form: row.dosageForm || '', strength: row.strength || '', barcode: row.barcode || '', price: row.unitSellingPrice ?? '', note: 'No confirmed source-name match; may be another spelling, pack, non-drug item, or a product absent from PALDOSE.' }));
  const qualityReview = active.flatMap(row => {
    const flags = [];
    if (String(row.dosageForm || '').trim().toLowerCase() === 'null') flags.push('literal_null_dosage_form');
    if (present(row.strength) && !/\d/.test(row.strength)) flags.push('strength_without_numeric_value_review');
    if (!flags.length) return [];
    return [{ vita_id: String(row._id), name: row.name, dosage_form: row.dosageForm || '', strength: row.strength || '', flags: flags.join(' | ') }];
  });
  const statuses = { confirmed_exact: 'تطابق اسم مؤكد', confirmed_normalized: 'تطابق بعد توحيد الكتابة', ambiguous: 'أكثر من سجل مطابق لدينا', review_similar: 'أسماء قريبة تحتاج مراجعة', no_candidate: 'لا مرشح بنفس بداية الاسم' };
  const summary = {
    auditedAt: new Date().toISOString(), source: manifest, localCapturedAt: snapshot.capturedAt,
    localTotal: snapshot.rows.length, localCentral: central.length, localActiveCentral: active.length,
    excludedCustom: snapshot.rows.length - central.length, externalRows: source.length,
    externalUniqueNames: new Set(source.map(row => exactKey(row['Commercial Name']))).size,
    sourceDuplicateNameRows: source.length - new Set(source.map(row => exactKey(row['Commercial Name']))).size,
    matches: counts, confirmedSourceRows: matched.length, confirmedUniqueVitaRecords: matchedVitaIds.size,
    unmatchedSourceRows: source.length - matched.length, missingAmongConfirmed: missingCounts,
    priceDifferencesForReview: differences.length, vitaFieldCoverage: localCoverage, sourceFieldPresence: sourcePresence,
    schemaGaps: ['commercial Arabic aliases', 'scientific Arabic aliases', 'structured pack size', 'indication/dose/route fields', 'pregnancy/lactation safety', 'HTN safety', 'diabetes safety', 'G6PD safety', 'external source identifier/version/date'],
    qualityReviewRows: qualityReview.length,
    limitations: ['Core public human-medicine catalog only; no veterinary catalog or private detail chunks requested.', 'No database writes. Unmatched does not prove absence; different spellings and packaging require review.', 'Names may omit pack size. Confirmed name matches do not prove identical presentation or clinical equivalence.', 'Company may identify a distributor/importer rather than the manufacturer.', 'Source prices are displayed as shekels on its website; package and price-date equivalence remain unverified.', 'Only factual catalog fields are exported; copyrighted clinical prose is not reproduced.', 'Clinical data was not independently verified; no automatic clinical enrichment is authorized by this audit.', 'The local catalog contains non-drug retail products and multiple presentations, so its row count is not a count of unique medicines.'],
  };
  function csv(name, rows) {
    const columns = [...new Set(rows.flatMap(Object.keys))];
    const quote = value => '"' + String(typeof value === 'string' && /^[=+@-]/.test(value) ? "'" + value : value ?? '').replaceAll('"', '""') + '"';
    fs.writeFileSync(path.join(output, name + '.csv'), '\uFEFF' + [columns, ...rows.map(row => columns.map(column => row[column]))].map(row => row.map(quote).join(',')).join('\r\n'));
  }
  const sheets = { PALDOSE_Catalog: factual, All_Matches: matches, Needs_Review: review, No_Candidate: noCandidate, Missing_Fields: gaps, Price_Review: differences, VITA_Field_Coverage: localCoverage, Source_Field_Presence: sourcePresence, Source_Duplicate_Names: sourceDuplicates, VITA_No_Confirmed_Match: localNotMatched, VITA_Quality_Review: qualityReview };
  Object.entries(sheets).forEach(([name, rows]) => csv(name, rows));
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(output, 'paldose-factual-catalog.json'), JSON.stringify(factual, null, 2));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(Object.entries(counts).map(([status, count]) => ({ status, label: statuses[status], count }))), 'Summary');
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = XLSX.utils.json_to_sheet(rows);
    if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
    sheet['!cols'] = Object.keys(rows[0] || {}).map(column => ({ wch: column.includes('name') || column.includes('fields') ? 48 : 22 }));
    XLSX.utils.book_append_sheet(book, sheet, name);
  }
  XLSX.writeFile(book, path.join(output, 'paldose-vita-comparison.xlsx'), { compression: true });
  console.log(JSON.stringify({ output, sourceRows: source.length, localRows: active.length, counts, missingCounts, priceReview: differences.length, examplesNoCandidate: noCandidate.slice(0, 8).map(row => row.source_name), examplesReview: review.slice(0, 5).map(row => ({ name: row.source_name, candidates: row.candidate_names })) }, null, 2));
}
module.exports = { nameKey, exactKey, classify, index, brandKey };
if (require.main === module) run();
