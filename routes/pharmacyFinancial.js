const express = require('express');
const router = express.Router();
const pharmacyFinancialController = require('../controllers/pharmacyFinancialController');

// Get financial summary for a pharmacy
router.get('/:pharmacyId/summary', pharmacyFinancialController.getFinancialSummary);

// Get detailed financial information with filters
router.get('/:pharmacyId/details', pharmacyFinancialController.getFinancialDetails);

// Get financial statistics for reports
router.get('/:pharmacyId/stats', pharmacyFinancialController.getFinancialStats);

// Add a transaction (income or expense)
router.post('/:pharmacyId/transaction', pharmacyFinancialController.addTransaction);

// Record an order payment as income
router.post('/:pharmacyId/order/:orderId/record-payment', pharmacyFinancialController.recordOrderPayment);

// Sync all completed orders as revenue
router.post('/:pharmacyId/sync-revenue', pharmacyFinancialController.syncOrderRevenue);

// Add a debt record
router.post('/:pharmacyId/debt', pharmacyFinancialController.addDebt);

// Pay a debt
router.post('/:pharmacyId/debt/:debtId/pay', pharmacyFinancialController.payDebt);

module.exports = router;
