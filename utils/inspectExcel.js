const XLSX = require('xlsx');
const path = require('path');

// Read the Excel file
const filePath = path.join(__dirname, 'استعلام الاصناف_28_8_2025  38 13.xls');
const workbook = XLSX.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Convert to JSON
const data = XLSX.utils.sheet_to_json(worksheet);

console.log('Total rows:', data.length);
console.log('\nFirst row (headers/sample):');
console.log(JSON.stringify(data[0], null, 2));

if (data.length > 1) {
  console.log('\nSecond row (sample data):');
  console.log(JSON.stringify(data[1], null, 2));
}

console.log('\nAll column headers:');
console.log(Object.keys(data[0]));
