const mongoose = require('mongoose');
const PharmacyFinancial = require('../models/PharmacyFinancial');
const Order = require('../models/Order');
const User = require('../models/User');

// Get pharmacy financial summary
exports.getFinancialSummary = async (req, res) => {
  try {
    const { pharmacyId } = req.params;

    let financial = await PharmacyFinancial.findOne({ pharmacyId });

    if (!financial) {
      financial = new PharmacyFinancial({ pharmacyId });
      await financial.save();
    }

    // Calculate monthly data from stored transactions
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const monthlyTransactions = financial.transactions?.filter(t => {
      const transactionDate = new Date(t.date);
      return transactionDate >= currentMonth && transactionDate < nextMonth;
    }) || [];

    const monthlyRevenue = monthlyTransactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);

    const monthlyExpenses = monthlyTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);

    // Calculate previous month for comparison
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthTransactions = financial.transactions?.filter(t => {
      const transactionDate = new Date(t.date);
      return transactionDate >= prevMonth && transactionDate < currentMonth;
    }) || [];

    const previousMonthRevenue = prevMonthTransactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);

    // Calculate percentage change
    let percentageChange = 0;
    if (previousMonthRevenue > 0) {
      percentageChange = ((monthlyRevenue - previousMonthRevenue) / previousMonthRevenue) * 100;
    } else if (monthlyRevenue > 0) {
      percentageChange = 100;
    }

    // Return financial summary
    const summary = {
      _id: financial._id,
      pharmacyId: financial.pharmacyId,
      totalRevenue: financial.totalRevenue || 0,
      totalExpenses: financial.totalExpenses || 0,
      netProfit: (financial.totalRevenue || 0) - (financial.totalExpenses || 0),
      accountBalance: financial.accountBalance || 0,
      currentMonth: financial.currentMonth,
      monthlyRevenue: monthlyRevenue,
      monthlyExpenses: monthlyExpenses,
      monthlyProfit: monthlyRevenue - monthlyExpenses,
      debts: financial.debts || [],
      totalDebts: financial.totalDebts || 0,
      pendingDebts: (financial.debts || []).filter(debt => debt.status === 'pending').reduce((sum, debt) => sum + debt.amount, 0),
      previousMonthEarnings: previousMonthRevenue,
      percentageChange,
      transactions: financial.transactions || [],
      lastUpdated: financial.lastUpdated,
      createdAt: financial.createdAt
    };

    res.json(summary);
  } catch (error) {
    console.error('Error fetching financial summary:', error);
    res.status(500).json({ message: 'Server error fetching financial data' });
  }
};

// Get financial details with filters
exports.getFinancialDetails = async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { startDate, endDate, category } = req.query;
    
    let financial = await PharmacyFinancial.findOne({ pharmacyId });
    
    if (!financial) {
      financial = new PharmacyFinancial({ pharmacyId });
      await financial.save();
    }
    
    let transactions = financial.transactions || [];
    
    // Filter by date range
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate) : new Date(0);
      const end = endDate ? new Date(endDate) : new Date();
      transactions = transactions.filter(t => t.date >= start && t.date <= end);
    }
    
    // Filter by category
    if (category) {
      transactions = transactions.filter(t => t.category === category);
    }
    
    // Sort by date descending
    transactions.sort((a, b) => b.date - a.date);
    
    res.json({
      financial,
      filteredTransactions: transactions,
      summary: {
        totalTransactions: transactions.length,
        totalIncome: transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0),
        totalExpense: transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0),
      }
    });
  } catch (error) {
    console.error('Error fetching financial details:', error);
    res.status(500).json({ message: 'Server error fetching financial details' });
  }
};

// Add transaction (income or expense)
exports.addTransaction = async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { type, category, amount, description, relatedId, relatedModel, reference, paymentMethod, status, notes } = req.body;
    
    if (!type || !amount) {
      return res.status(400).json({ message: 'Type and amount are required' });
    }
    
    let financial = await PharmacyFinancial.findOne({ pharmacyId });
    
    if (!financial) {
      financial = new PharmacyFinancial({ pharmacyId });
    }
    
    // Create transaction
    const transaction = {
      transactionId: new mongoose.Types.ObjectId(),
      type,
      category: category || 'adjustment',
      amount,
      description,
      relatedId,
      relatedModel,
      reference,
      paymentMethod,
      status: status || 'completed',
      date: new Date(),
      notes,
      createdBy: req.user ? req.user.id : null
    };
    
    financial.transactions.push(transaction);
    
    // Update totals
    if (type === 'income') {
      financial.totalRevenue += amount;
      financial.monthlyRevenue += amount;
      financial.accountBalance += amount;
    } else if (type === 'expense') {
      financial.totalExpenses += amount;
      financial.monthlyExpenses += amount;
      financial.accountBalance -= amount;
    }
    
    await financial.save();
    
    res.status(201).json({
      message: 'Transaction added successfully',
      transaction,
      financial
    });
  } catch (error) {
    console.error('Error adding transaction:', error);
    res.status(500).json({ message: 'Server error adding transaction' });
  }
};

// Record order payment as income
exports.recordOrderPayment = async (req, res) => {
  try {
    const { pharmacyId, orderId } = req.params;
    
    // Get order details
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    let financial = await PharmacyFinancial.findOne({ pharmacyId });
    
    if (!financial) {
      financial = new PharmacyFinancial({ pharmacyId });
    }
    
    // Create income transaction
    const transaction = {
      transactionId: new mongoose.Types.ObjectId(),
      type: 'income',
      category: 'order',
      amount: order.total,
      description: `Order payment - Order #${orderId.slice(-6)}`,
      relatedId: orderId,
      relatedModel: 'Order',
      reference: order._id.toString(),
      status: 'completed',
      date: new Date(),
    };
    
    financial.transactions.push(transaction);
    financial.totalRevenue += order.total;
    financial.monthlyRevenue += order.total;
    financial.accountBalance += order.total;
    
    await financial.save();
    
    res.json({
      message: 'Order payment recorded successfully',
      financial
    });
  } catch (error) {
    console.error('Error recording order payment:', error);
    res.status(500).json({ message: 'Server error recording payment' });
  }
};

// Get financial statistics for reports
exports.getFinancialStats = async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { period = 'month' } = req.query; // 'week', 'month', 'year', 'all'
    
    let financial = await PharmacyFinancial.findOne({ pharmacyId });
    
    if (!financial) {
      financial = new PharmacyFinancial({ pharmacyId });
      await financial.save();
    }
    
    let transactions = financial.transactions || [];
    const now = new Date();
    
    // Filter transactions based on period
    if (period === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      transactions = transactions.filter(t => t.date >= weekAgo);
    } else if (period === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      transactions = transactions.filter(t => t.date >= monthAgo);
    } else if (period === 'year') {
      const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      transactions = transactions.filter(t => t.date >= yearAgo);
    }
    
    // Calculate statistics
    const stats = {
      period,
      totalRevenue: transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0),
      totalExpenses: transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0),
      totalTransactions: transactions.length,
      byCategory: {},
      dailyTrend: []
    };
    
    // Group by category
    transactions.forEach(t => {
      if (!stats.byCategory[t.category]) {
        stats.byCategory[t.category] = { count: 0, amount: 0 };
      }
      stats.byCategory[t.category].count++;
      stats.byCategory[t.category].amount += t.amount;
    });
    
    stats.netProfit = stats.totalRevenue - stats.totalExpenses;
    
    res.json(stats);
  } catch (error) {
    console.error('Error fetching financial stats:', error);
    res.status(500).json({ message: 'Server error fetching statistics' });
  }
};

// Sync order revenue (call this when order is completed)
exports.syncOrderRevenue = async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    
    // Get all completed and paid orders for this pharmacy
    const orders = await Order.find({ pharmacyId, status: { $in: ['completed', 'paid'] } });
    
    let financial = await PharmacyFinancial.findOne({ pharmacyId });
    
    if (!financial) {
      financial = new PharmacyFinancial({ pharmacyId });
    }
    
    let totalNewRevenue = 0;
    
    for (const order of orders) {
      // Check if this order is already recorded
      const existingTransaction = financial.transactions.find(
        t => t.relatedId && t.relatedId.toString() === order._id.toString()
      );
      
      if (!existingTransaction) {
        // Add transaction for this order
        financial.transactions.push({
          transactionId: new mongoose.Types.ObjectId(),
          type: 'income',
          category: 'order',
          amount: order.total,
          description: `Order #${order._id.slice(-6)}`,
          relatedId: order._id,
          relatedModel: 'Order',
          reference: order._id.toString(),
          status: 'completed',
          date: order.createdAt || new Date(),
        });
        
        totalNewRevenue += order.total;
      }
    }
    
    if (totalNewRevenue > 0) {
      financial.totalRevenue += totalNewRevenue;
      financial.monthlyRevenue += totalNewRevenue;
      financial.accountBalance += totalNewRevenue;
      await financial.save();
    }
    
    res.json({
      message: 'Revenue synced successfully',
      newRevenueRecorded: totalNewRevenue,
      financial
    });
  } catch (error) {
    console.error('Error syncing revenue:', error);
    res.status(500).json({ message: 'Server error syncing revenue' });
  }
};

// Add a debt record
exports.addDebt = async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { amount, description, patientName, patientId, patientPhone, date } = req.body;

    if (!amount || !description || !patientName) {
      return res.status(400).json({ message: 'Amount, description, and patient name are required' });
    }

    let financial = await PharmacyFinancial.findOne({ pharmacyId });
    
    if (!financial) {
      financial = new PharmacyFinancial({ pharmacyId });
    }

    const debtRecord = {
      id: Date.now().toString(),
      type: 'debt',
      amount: parseFloat(amount),
      description,
      patientName,
      patientId: patientId || null,
      patientPhone: patientPhone || '',
      date: date ? new Date(date) : new Date(),
      status: 'pending',
      createdAt: new Date()
    };

    financial.debts = financial.debts || [];
    financial.debts.push(debtRecord);

    // Update total debts
    financial.totalDebts = (financial.totalDebts || 0) + parseFloat(amount);

    await financial.save();

    res.json({
      message: 'Debt added successfully',
      debt: debtRecord,
      financial
    });
  } catch (error) {
    console.error('Error adding debt:', error);
    res.status(500).json({ message: 'Server error adding debt' });
  }
};

// Pay a debt
exports.payDebt = async (req, res) => {
  try {
    const { pharmacyId, debtId } = req.params;

    let financial = await PharmacyFinancial.findOne({ pharmacyId });

    if (!financial) {
      return res.status(404).json({ message: 'Financial record not found' });
    }

    const debtIndex = financial.debts.findIndex(d => d.id === debtId);

    if (debtIndex === -1) {
      return res.status(404).json({ message: 'Debt not found' });
    }

    const debt = financial.debts[debtIndex];

    if (debt.status === 'paid') {
      return res.status(400).json({ message: 'Debt is already paid' });
    }

    // Mark debt as paid
    debt.status = 'paid';
    debt.paidAt = new Date();

    // Update total debts
    financial.totalDebts = (financial.totalDebts || 0) - debt.amount;

    // Record debt payment as income
    const transaction = {
      transactionId: new mongoose.Types.ObjectId(),
      type: 'income',
      category: 'debt-payment',
      amount: debt.amount,
      description: `Debt payment from ${debt.patientName}`,
      relatedId: debtId,
      relatedModel: 'Debt',
      reference: debtId,
      paymentMethod: 'Cash', // Default to cash, can be updated later
      status: 'completed',
      date: new Date(),
      notes: `Debt payment received`
    };

    financial.transactions.push(transaction);
    financial.totalRevenue += debt.amount;
    financial.monthlyRevenue += debt.amount;
    financial.accountBalance += debt.amount;

    // Send WhatsApp thank you message ONLY from pharmacy WhatsApp (not system)
    try {
      const { sendPharmacyWhatsAppMessage } = require('../services/whatsappService');
      if (debt.patientPhone) {
        const amount = debt.amount;
        const paidAt = debt.paidAt;
        const formattedDate = paidAt.toLocaleDateString('ar-EG');
        const message = `شكرًا لك على سداد دينك بقيمة ${amount} شيكل بتاريخ ${formattedDate}`;
        await sendPharmacyWhatsAppMessage(pharmacyId, debt.patientPhone, message);
      }
    } catch (whatsappError) {
      console.error('Failed to send WhatsApp thank you:', whatsappError);
    }

    await financial.save();

    res.json({
      message: 'Debt paid successfully',
      debt,
      financial
    });
  } catch (error) {
    console.error('Error paying debt:', error);
    res.status(500).json({ message: 'Server error paying debt' });
  }
};

module.exports = exports;
