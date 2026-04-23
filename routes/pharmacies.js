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
    
    // Check subscription type first (can be 'paid', 'free', or undefined)
    const isPaid = user.subscriptionType === 'paid' || user.isPaid === true;
    
    let trialEndDate = user.trialEndDate;
    const now = new Date();
    const isTrialActive = !isPaid && trialEndDate && now < trialEndDate;
    const timeLeft = isTrialActive ? trialEndDate - now : 0;
    
    res.json({
      isTrialActive,
      trialEndDate,
      timeLeft,
      isPaid: isPaid,
      hasAcceptedOffer: user.hasAcceptedOffer || false,
      trialUsed: user.trialUsed || false,
      dashboardRemainingTrialMs: user.dashboardRemainingTrialMs || null,
      hasSavedCard: !!(user.savedCard && user.savedCard.maskedNumber),
      savedCard: user.savedCard ? {
        last4: user.savedCard.maskedNumber ? user.savedCard.maskedNumber.slice(-4) : null,
        cardHolder: user.savedCard.cardHolder,
        expiryDate: user.savedCard.expiryDate,
      } : null,
      subscriptionEndDate: user.subscriptionEndDate,
      subscriptionType: user.subscriptionType,
      subscriptionStatus: user.subscriptionStatus,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Accept trial offer - save card and start 7-day trial (or resume remaining time)
router.post('/:id/accept-offer', auth, async (req, res) => {
  try {
    const { cardNumber, cardHolder, expiryDate, cvv } = req.body;
    if (!cardNumber || !cardHolder || !expiryDate || !cvv) {
      return res.status(400).json({ message: 'All card details are required' });
    }
    
    const user = await require('../models/User').findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;

    // Check if trial was already fully used (expired naturally, not cancelled)
    if (user.trialUsed && !user.dashboardRemainingTrialMs) {
      return res.status(400).json({ message: 'Trial period has already been used. Please subscribe to continue.' });
    }

    // Save masked card info
    const cleanCard = cardNumber.replace(/\s/g, '');
    const masked = '**** **** **** ' + cleanCard.slice(-4);
    user.savedCard = {
      maskedNumber: masked,
      cardHolder,
      expiryDate,
      cardToken: Buffer.from(cleanCard + '|' + cvv + '|' + expiryDate).toString('base64'),
      savedAt: now,
    };

    let trialEnd;
    let isResume = false;
    let remainingDays;

    if (user.dashboardRemainingTrialMs && user.dashboardRemainingTrialMs > 0) {
      // Resume: give remaining time back
      isResume = true;
      trialEnd = new Date(now.getTime() + user.dashboardRemainingTrialMs);
      remainingDays = Math.ceil(user.dashboardRemainingTrialMs / msPerDay);
      user.dashboardRemainingTrialMs = null;
      user.dashboardTrialCancelledAt = null;
    } else {
      // Fresh 7-day trial
      trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 7);
      remainingDays = 7;
    }

    user.trialEndDate = trialEnd;
    user.hasAcceptedOffer = true;
    user.offerAcceptedAt = now;
    user.trialUsed = true;
    user.isPaid = false;

    await user.save({ validateBeforeSave: false });

    res.json({
      success: true,
      isResume,
      remainingDays,
      message: isResume
        ? `Trial resumed! You have ${remainingDays} day(s) remaining.`
        : 'Trial activated! You have 7 days to try all features.',
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

    const now = new Date();

    if (user.isPaid) {
      // Cancel paid subscription
      user.isPaid = false;
      user.subscriptionEndDate = now;
      user.trialEndDate = now;
    } else if (user.trialEndDate && now < user.trialEndDate) {
      // Cancel active trial - save remaining time
      const remaining = user.trialEndDate.getTime() - now.getTime();
      user.dashboardRemainingTrialMs = remaining;
      user.dashboardTrialCancelledAt = now;
      user.trialEndDate = now; // end trial immediately
      user.hasAcceptedOffer = false;
    }

    // Also cancel Vita AI chatbot if active
    if (user.vitatAI) {
      const vitatAI = user.vitatAI;
      if (vitatAI.hasAcceptedTrial && vitatAI.trialEndDate && now < vitatAI.trialEndDate) {
        // Cancel active Vita AI trial - save remaining time
        const remaining = vitatAI.trialEndDate.getTime() - now.getTime();
        user.vitatAI.remainingTrialMs = remaining;
        user.vitatAI.trialCancelledAt = now;
        user.vitatAI.trialEndDate = now;
        user.vitatAI.hasAcceptedTrial = false;
      } else if (vitatAI.isSubscribed && vitatAI.subscriptionEndDate && now < vitatAI.subscriptionEndDate) {
        // Cancel active Vita AI subscription
        user.vitatAI.isSubscribed = false;
        user.vitatAI.subscriptionEndDate = now;
        user.vitatAI.subscriptionStatus = 'cancelled';
      }
    }

    await user.save({ validateBeforeSave: false });

    res.json({ success: true, message: 'Subscription cancelled' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
