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

// Subscription / Trial offer
router.get('/:id/trial-status', auth, async (req, res) => {
  try {
    const user = await require('../models/User').findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    let trialEndDate = user.trialEndDate;
    const now = new Date();
    const isTrialActive = !user.isPaid && trialEndDate && now < trialEndDate;
    const timeLeft = isTrialActive ? trialEndDate - now : 0;
    
    res.json({
      isTrialActive,
      trialEndDate,
      timeLeft,
      isPaid: user.isPaid,
      hasAcceptedOffer: user.hasAcceptedOffer || false,
      trialUsed: user.trialUsed || false,
      hasSavedCard: !!(user.savedCard && user.savedCard.maskedNumber),
      subscriptionEndDate: user.subscriptionEndDate,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Accept trial offer - save card and start 7-day trial
router.post('/:id/accept-offer', auth, async (req, res) => {
  try {
    const { cardNumber, cardHolder, expiryDate, cvv } = req.body;
    if (!cardNumber || !cardHolder || !expiryDate || !cvv) {
      return res.status(400).json({ message: 'All card details are required' });
    }
    
    const user = await require('../models/User').findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    // Check if trial was already used
    if (user.trialUsed) {
      return res.status(400).json({ message: 'Trial period has already been used. Please subscribe to continue.' });
    }
    
    // Save masked card info
    const cleanCard = cardNumber.replace(/\s/g, '');
    const masked = '**** **** **** ' + cleanCard.slice(-4);
    
    user.savedCard = {
      maskedNumber: masked,
      cardHolder,
      expiryDate,
      cardToken: Buffer.from(cleanCard + '|' + cvv + '|' + expiryDate).toString('base64'), // Simple encoding for now
      savedAt: new Date(),
    };
    
    // Set 7-day trial from now
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 7);
    user.trialEndDate = trialEnd;
    user.hasAcceptedOffer = true;
    user.offerAcceptedAt = new Date();
    user.trialUsed = true;
    user.isPaid = false; // Still in trial
    
    await user.save({ validateBeforeSave: false });
    
    res.json({
      success: true,
      message: 'Trial activated! You have 7 days to try all features.',
      trialEndDate: trialEnd,
      maskedCard: masked,
    });
  } catch (error) {
    console.error('Accept offer error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Subscribe - charge card and upgrade to paid
router.post('/:id/subscribe', auth, async (req, res) => {
  try {
    const user = await require('../models/User').findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    if (user.isPaid) {
      return res.status(400).json({ message: 'Already subscribed' });
    }

    if (!user.savedCard || !user.savedCard.maskedNumber) {
      return res.status(400).json({ message: 'No saved card found. Please contact support.' });
    }

    // TODO: Integrate real payment gateway here
    // For now, simulate successful charge of 50 NIS
    const chargeAmount = 50;

    user.isPaid = true;
    // Set subscription for 30 days from now
    const subEnd = new Date();
    subEnd.setDate(subEnd.getDate() + 30);
    user.subscriptionEndDate = subEnd;
    user.trialEndDate = subEnd;
    
    await user.save({ validateBeforeSave: false });
    
    res.json({ 
      success: true, 
      message: 'Subscription activated successfully',
      amount: chargeAmount,
      subscriptionEndDate: subEnd,
      maskedCard: user.savedCard.maskedNumber
    });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Cancel subscription / offer
router.post('/:id/cancel-offer', auth, async (req, res) => {
  try {
    const user = await require('../models/User').findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    user.savedCard = undefined;
    user.hasAcceptedOffer = false;
    user.isPaid = false;
    // Reset trial to expired
    user.trialEndDate = new Date(); 
    
    await user.save({ validateBeforeSave: false });
    
    res.json({ success: true, message: 'Subscription cancelled' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
