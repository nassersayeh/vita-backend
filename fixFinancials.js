const mongoose = require('mongoose');

mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.rsdkh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0').then(async () => {
  console.log('Connected to MongoDB');
  
  // Update directly using raw MongoDB to bypass Mongoose validation
  const db = mongoose.connection.db;
  const collection = db.collection('financials');
  
  // Find all financials
  const financials = await collection.find({}).toArray();
  console.log('Found', financials.length, 'financial records');
  
  for (const f of financials) {
    let updates = {};
    
    // Check if totalEarnings is not a valid finite number
    if (f.totalEarnings === null || f.totalEarnings === undefined || !Number.isFinite(f.totalEarnings) || typeof f.totalEarnings === 'string') {
      // Recalculate from transactions
      const total = (f.transactions || []).reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      updates.totalEarnings = total;
      console.log('Doctor:', f.doctorId, '- Fixing totalEarnings from', f.totalEarnings, 'to', total);
    }
    
    // Check if totalExpenses is not a valid finite number
    if (f.totalExpenses === null || f.totalExpenses === undefined || !Number.isFinite(f.totalExpenses) || typeof f.totalExpenses === 'string') {
      // Recalculate from expenses
      const total = (f.expenses || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      updates.totalExpenses = total;
      console.log('Doctor:', f.doctorId, '- Fixing totalExpenses from', f.totalExpenses, 'to', total);
    }
    
    if (Object.keys(updates).length > 0) {
      await collection.updateOne({ _id: f._id }, { $set: updates });
      console.log('Updated!');
    }
  }
  
  console.log('Done!');
  mongoose.disconnect();
}).catch(console.error);
