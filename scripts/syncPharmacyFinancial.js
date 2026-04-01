const mongoose = require('mongoose');
const Order = require('../models/Order');
const PharmacyFinancial = require('../models/PharmacyFinancial');

// Import models to register them
const User = require('../models/User');
const Product = require('../models/Product');
const Notification = require('../models/Notification');
const Points = require('../models/Points');

async function syncExistingOrders() {
  try {
    console.log('Starting sync of existing orders to PharmacyFinancial...');

    // Get all completed orders
    const orders = await Order.find({ status: 'completed' }).populate('user', 'fullName phone');
    console.log(`Found ${orders.length} completed orders`);

    // Group orders by pharmacy
    const pharmacyOrders = {};
    orders.forEach(order => {
      const pharmacyId = order.pharmacyId || order.user?._id;
      if (!pharmacyId) return;

      if (!pharmacyOrders[pharmacyId]) {
        pharmacyOrders[pharmacyId] = [];
      }
      pharmacyOrders[pharmacyId].push(order);
    });

    console.log(`Found orders for ${Object.keys(pharmacyOrders).length} pharmacies`);

    // Process each pharmacy
    for (const [pharmacyId, orders] of Object.entries(pharmacyOrders)) {
      console.log(`Processing pharmacy ${pharmacyId} with ${orders.length} orders`);

      // Get or create PharmacyFinancial record
      let financial = await PharmacyFinancial.findOne({ pharmacyId });
      if (!financial) {
        financial = new PharmacyFinancial({ pharmacyId });
        console.log(`Created new PharmacyFinancial record for pharmacy ${pharmacyId}`);
      }

      // Calculate revenue from orders
      let totalRevenue = 0;
      let monthlyRevenue = 0;
      const currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

      const transactions = [];

      orders.forEach(order => {
        const orderDate = new Date(order.createdAt);
        const orderRevenue = order.total || 0;

        // Add to total revenue
        totalRevenue += orderRevenue;

        // Add to monthly revenue if in current month
        if (orderDate >= currentMonth) {
          monthlyRevenue += orderRevenue;
        }

        // Add transaction record
        transactions.push({
          transactionId: order._id,
          type: 'income',
          amount: orderRevenue,
          description: `POS Order - ${order.items?.length || 0} items`,
          date: orderDate,
          orderId: order._id
        });
      });

      // Update financial record
      financial.totalRevenue = totalRevenue;
      financial.monthlyRevenue = monthlyRevenue;
      financial.transactions = transactions;

      await financial.save();
      console.log(`Updated pharmacy ${pharmacyId}: totalRevenue=${totalRevenue}, monthlyRevenue=${monthlyRevenue}`);
    }

    console.log('Sync completed successfully!');
  } catch (error) {
    console.error('Error syncing orders:', error);
  } finally {
    mongoose.connection.close();
  }
}

// Run if called directly
if (require.main === module) {
  require('dotenv').config();
  mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.rsdkh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0')
    .then(() => {
      console.log('Connected to MongoDB');
      return syncExistingOrders();
    })
    .catch(err => {
      console.error('MongoDB connection error:', err);
      process.exit(1);
    });
}

module.exports = syncExistingOrders;