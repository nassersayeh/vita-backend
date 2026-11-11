const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nameKey, exactKey, classify, index, brandKey } = require('../scripts/comparePaldoseCatalog.cjs');
function match(name, names) {
  const rows = names.map((name, i) => ({ _id: String(i), name }));
  return classify({ 'Commercial Name': name }, { exact: index(rows, exactKey), normalized: index(rows, nameKey), brands: index(rows, brandKey) });
}
test('name comparison tolerates formatting and dosage-form abbreviations', () => {
  assert.equal(match('EXAMPLE 500 MG 20 TABLETS', ['example 500mg 20 tab']).status, 'confirmed_normalized');
  assert.equal(match('EXAMPLE 500 MG', [' example 500 mg ']).status, 'confirmed_exact');
});
test('different strengths, volumes and pack quantities cannot become confirmed name matches', () => {
  for (const candidate of ['EXAMPLE 250 MG 20 TAB', 'EXAMPLE 500 MG 10 TAB', 'EXAMPLE 500 MG 20 ML']) {
    assert.equal(match('EXAMPLE 500 MG 20 TAB', [candidate]).status, 'review_similar');
  }
  assert.notEqual(nameKey('EXAMPLE 0.5 MG'), nameKey('EXAMPLE 5 MG'));
  assert.notEqual(nameKey('EXAMPLE 0.05% CREAM'), nameKey('EXAMPLE 0.5% CREAM'));
});
test('duplicate local names remain ambiguous and unrelated names have no candidate', () => {
  assert.equal(match('EXAMPLE 500 MG', ['EXAMPLE 500 MG', 'example 500 mg']).status, 'ambiguous');
  assert.equal(match('EXAMPLE 500 MG', ['OTHER BRAND 500 MG']).status, 'no_candidate');
});
