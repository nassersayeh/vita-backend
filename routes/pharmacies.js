// routes/pharmacies.js
const express = require('express');
const router = express.Router();
const { getPharmacyProfile } = require('../controllers/userController');
const pharmacyController = require('../controllers/pharmacyController');


router.get('/', pharmacyController.getAllPharmacies);

// GET /api/pharmacies/:id
router.get('/:id', pharmacyController.getPharmacyById);
router.get('/:id', getPharmacyProfile);
router.get('/city/:city',  pharmacyController.getPharmaciesByCity);

// Pharmacy customers (protected)
const auth = require('../middleware/auth');
router.get('/:id/customers', auth, pharmacyController.getCustomersForPharmacy);
router.post('/:id/customers', auth, pharmacyController.createCustomerForPharmacy);
router.put('/:id/customers/:customerId', auth, pharmacyController.updateCustomerForPharmacy);
router.delete('/:id/customers/:customerId', auth, pharmacyController.deleteCustomerForPharmacy);

// Pharmacy insurance companies (protected)
router.get('/:id/insurance-companies', auth, pharmacyController.getInsuranceCompaniesForPharmacy);
router.post('/:id/insurance-companies', auth, pharmacyController.addInsuranceCompanyForPharmacy);
router.delete('/:id/insurance-companies/:companyName', auth, pharmacyController.deleteInsuranceCompanyForPharmacy);

module.exports = router;
