const express = require('express');
const router = express.Router();
const pharmacyCustomerController = require('../controllers/pharmacyCustomerController');

// Get all customers for a pharmacy
router.get('/:pharmacyId/customers', pharmacyCustomerController.getAllCustomers);
// Create a new customer
router.post('/:pharmacyId/customers', pharmacyCustomerController.createCustomer);
// Update a customer
router.put('/:pharmacyId/customers/:customerId', pharmacyCustomerController.updateCustomer);
// Get a single customer
router.get('/:pharmacyId/customers/:customerId', pharmacyCustomerController.getCustomer);
// Send WhatsApp message to a customer
router.post('/:pharmacyId/customers/:customerId/send-whatsapp', pharmacyCustomerController.sendWhatsAppMessage);

module.exports = router;
