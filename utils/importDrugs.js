const XLSX = require('xlsx');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Drug = require('../models/Drug');

// Helper function to convert Excel date serial to JavaScript Date
function excelDateToJSDate(serial) {
  if (!serial || isNaN(serial)) return null;
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const date_info = new Date(utc_value * 1000);
  return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate());
}

// Helper function to clean string values
function cleanString(value) {
  if (!value) return '';
  return String(value).trim();
}

// Helper function to parse boolean from checkbox values
function parseBoolean(value) {
  if (!value) return false;
  return String(value).toLowerCase() === 'checked';
}

async function importDrugs() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://nassersayeh:pop1990@cluster0.vefyn0g.mongodb.net/?appName=Cluster0');
    console.log('Connected to MongoDB successfully!');

    // Read the Excel file
    console.log('\nReading Excel file...');
    const filePath = path.join(__dirname, 'استعلام الاصناف_28_8_2025  38 13.xls');
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    console.log(`Found ${data.length} records in Excel file`);

    // Clear existing drugs (optional - comment out if you want to keep existing data)
    console.log('\nClearing existing drugs...');
    await Drug.deleteMany({});
    console.log('Existing drugs cleared');

    // Process and insert drugs in batches
    console.log('\nImporting drugs...');
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    const BATCH_SIZE = 500;

    // Prepare all drug data first
    const allDrugs = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      try {
        const drugData = {
          itemId: cleanString(row['رقم الصنف']),
          barcode: cleanString(row['بار كود']) || null,
          name: cleanString(row['اسم الصنف']) || `Drug ${i + 1}`,
          currentQuantity: Number(row['ك.حالية']) || 0,
          mainSupplier: cleanString(row['اسم المورد الرئيسي']),
          lastPurchasePrice: Number(row['اخر سعر شراء']) || 0,
          purchasePriceCurrency: cleanString(row['عملة أخر سعر شراء']) || 'شيقل',
          unitSellingPrice: Number(row['سعر بيع الوحدة الرئيسية']) || 0,
          lastUpdateDate: excelDateToJSDate(row['التاريخ']),
          sellingPriceCurrency: cleanString(row['عملة سعر بيع الوحدة الرئيسية']) || 'شيقل',
          wholesalePrice: Number(row['سعر البيع جملة']) || 0,
          isFrozen: parseBoolean(row['الصنف مجمد']),
          warehouse: cleanString(row['المستودع']) || 'Main Store',
          bulkWholesalePrice: Number(row['سعر بيع جملة الجملة']) || 0,
          hasAlternatives: parseBoolean(row['له بدائل']),
          hasFollowups: parseBoolean(row['له توابع']),
          isActive: true,
          category: 'General'
        };
        allDrugs.push(drugData);
      } catch (error) {
        errorCount++;
        errors.push({ row: i + 1, itemId: row['رقم الصنف'], name: row['اسم الصنف'], error: error.message });
      }
    }

    // Insert in batches using insertMany with ordered: false (continue on error)
    for (let i = 0; i < allDrugs.length; i += BATCH_SIZE) {
      const batch = allDrugs.slice(i, i + BATCH_SIZE);
      try {
        const result = await Drug.insertMany(batch, { ordered: false });
        successCount += result.length;
      } catch (error) {
        // With ordered: false, some may succeed even if others fail (duplicate keys etc.)
        if (error.insertedDocs) {
          successCount += error.insertedDocs.length;
        }
        if (error.writeErrors) {
          errorCount += error.writeErrors.length;
          error.writeErrors.slice(0, 5).forEach(we => {
            errors.push({ row: i + we.index + 1, error: we.errmsg });
          });
        }
      }
      console.log(`Processed ${Math.min(i + BATCH_SIZE, allDrugs.length)}/${allDrugs.length} records...`);
    }

    // Summary
    console.log('\n=================================');
    console.log('Import Summary:');
    console.log('=================================');
    console.log(`Total records in file: ${data.length}`);
    console.log(`Successfully imported: ${successCount}`);
    console.log(`Failed: ${errorCount}`);
    console.log('=================================');

    if (errors.length > 0 && errors.length <= 50) {
      console.log('\nErrors:');
      errors.forEach(err => {
        console.log(`Row ${err.row} (${err.itemId} - ${err.name}): ${err.error}`);
      });
    } else if (errors.length > 50) {
      console.log(`\nToo many errors (${errors.length}) to display. Check the first few above.`);
    }

    // Verify count in database
    const dbCount = await Drug.countDocuments();
    console.log(`\nTotal drugs in database: ${dbCount}`);

  } catch (error) {
    console.error('Fatal error during import:', error);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('\nMongoDB connection closed');
  }
}

// Run the import
importDrugs();
