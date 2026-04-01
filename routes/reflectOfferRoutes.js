const express = require('express');
const router = express.Router();
const reflectOfferController = require('../controllers/reflectOfferController');

router.post('/', reflectOfferController.createReflectOffer);
router.get('/reflect/:offerId', reflectOfferController.getReflectOffer);
router.put('/:offerId', reflectOfferController.updateReflectOffer);
router.get('/', reflectOfferController.getAllReflectOffers);
router.get('/user/:userId', reflectOfferController.getReflectOfferForUser);


module.exports = router;
