const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const pharmacyInventoryController = require('../controllers/pharmacyInventoryController');

// Protect all routes with authentication
router.use(auth);

// GET pharmacy inventory
router.get('/pharmacy/:pharmacyId', 
  pharmacyInventoryController.getPharmacyInventory
);

// GET scan by barcode for a pharmacy inventory
router.get('/pharmacy/:pharmacyId/scan', pharmacyInventoryController.scanByBarcode);

// GET available drugs to add (not yet in inventory)
router.get('/pharmacy/:pharmacyId/available-drugs', 
  pharmacyInventoryController.getAvailableDrugsToAdd
);

// GET low stock items
router.get('/pharmacy/:pharmacyId/low-stock', 
  pharmacyInventoryController.getLowStockItems
);

// POST add drug to inventory
router.post('/pharmacy/:pharmacyId/add', 
  pharmacyInventoryController.addDrugToInventory
);

// PUT update inventory item
router.put('/pharmacy/:pharmacyId/drug/:drugId', 
  pharmacyInventoryController.updateInventoryItem
);

// DELETE remove from inventory
router.delete('/pharmacy/:pharmacyId/drug/:drugId', 
  pharmacyInventoryController.removeFromInventory
);

module.exports = router;
