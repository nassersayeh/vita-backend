const express = require('express');
const router = express.Router();
const providerController = require('../controllers/providerController');
const auth = require('../middleware/auth');

router.get('/:id', providerController.getProviderDetails);
router.post('/:id/connect', auth, providerController.connectProvider);

module.exports = router;
