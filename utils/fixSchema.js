const mongoose = require('mongoose');
const path = require('path');

async function fixDrugSchema() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.rsdkh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');
    console.log('Connected to MongoDB successfully!');

    // Drop the drugs collection to remove old indexes
    console.log('\nDropping existing drugs collection...');
    await mongoose.connection.collection('drugs').drop().catch(() => {
      console.log('Collection does not exist or already dropped');
    });

    console.log('Schema fixed. You can now run the import again.');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

fixDrugSchema();
