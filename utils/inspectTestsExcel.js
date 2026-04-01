const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '../../vita-web/src/utils/تسعيرة النقابة 2018.xls');
const workbook = XLSX.readFile(filePath);

console.log('Sheet names:', workbook.SheetNames);

const sheet = workbook.Sheets['Sheet1'];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
console.log('Total rows (including header):', data.length);

// Print last 10 rows
console.log('\n--- Last 10 rows ---');
for (let i = Math.max(1, data.length - 10); i < data.length; i++) {
  console.log('Row', i, ':', JSON.stringify(data[i]));
}

// Count valid tests (rows with all 3 fields)
let validCount = 0;
let priceRange = { min: Infinity, max: -Infinity };
for (let i = 1; i < data.length; i++) {
  if (data[i] && data[i][1] && data[i][2] !== undefined) {
    validCount++;
    if (typeof data[i][2] === 'number') {
      priceRange.min = Math.min(priceRange.min, data[i][2]);
      priceRange.max = Math.max(priceRange.max, data[i][2]);
    }
  }
}
console.log('\nValid tests:', validCount);
console.log('Price range:', priceRange.min, '-', priceRange.max);
