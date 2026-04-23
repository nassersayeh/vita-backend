// routes/vitatAI.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// Get VitatAI subscription status
router.get('/:id/status', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    const vitatAI = user.vitatAI || {};
    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;
    
    // Check trial status
    const isTrialActive = vitatAI.hasAcceptedTrial && vitatAI.trialEndDate && now < vitatAI.trialEndDate;
    const trialTimeLeft = isTrialActive ? Math.ceil((vitatAI.trialEndDate - now) / msPerDay) : 0;
    
    // Check subscription status
    const isSubscribed = vitatAI.isSubscribed && vitatAI.subscriptionEndDate && now < vitatAI.subscriptionEndDate;
    const subscriptionTimeLeft = isSubscribed ? Math.ceil((vitatAI.subscriptionEndDate - now) / msPerDay) : 0;
    
    // Check if user gets additional trial days (from using chatbot during free trial)
    const hasAdditionalTrial = vitatAI.additionalTrialDaysGranted > 0 && vitatAI.additionalTrialEndDate && now < vitatAI.additionalTrialEndDate;
    const additionalTrialTimeLeft = hasAdditionalTrial ? Math.ceil((vitatAI.additionalTrialEndDate - now) / msPerDay) : 0;
    
    // User can access chatbot if: in trial OR subscribed
    const canAccessChatbot = isTrialActive || isSubscribed;
    
    res.json({
      vitatAI: {
        hasAcceptedTrial: vitatAI.hasAcceptedTrial || false,
        isTrialActive,
        trialStartDate: vitatAI.trialStartDate,
        trialEndDate: vitatAI.trialEndDate,
        trialTimeLeft,
        
        isSubscribed,
        subscriptionStartDate: vitatAI.subscriptionStartDate,
        subscriptionEndDate: vitatAI.subscriptionEndDate,
        subscriptionStatus: vitatAI.subscriptionStatus,
        subscriptionTimeLeft,
        
        additionalTrialDaysGranted: vitatAI.additionalTrialDaysGranted || 0,
        hasAdditionalTrial,
        additionalTrialStartDate: vitatAI.additionalTrialStartDate,
        additionalTrialEndDate: vitatAI.additionalTrialEndDate,
        additionalTrialTimeLeft,
        
        canAccessChatbot,
      },
      hasSavedCard: !!(user.savedCard && user.savedCard.maskedNumber),
      savedCard: user.savedCard ? {
        last4: user.savedCard.maskedNumber ? user.savedCard.maskedNumber.slice(-4) : null,
        cardHolder: user.savedCard.cardHolder,
        expiryDate: user.savedCard.expiryDate,
      } : null,
    });
  } catch (error) {
    console.error('VitatAI status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Accept trial offer - save card and start 3-day trial
router.post('/:id/accept-trial', auth, async (req, res) => {
  try {
    const { cardNumber, cardHolder, expiryDate, cvv } = req.body;
    if (!cardNumber || !cardHolder || !expiryDate || !cvv) {
      return res.status(400).json({ message: 'All card details are required' });
    }
    
    const User = require('../models/User');
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const now = new Date();
    const vitatAI = user.vitatAI || {};

    // Block only if trial is currently active OR fully expired with no remaining time
    const isTrialCurrentlyActive = vitatAI.hasAcceptedTrial && vitatAI.trialEndDate && now < new Date(vitatAI.trialEndDate);
    const hasRemainingTime = vitatAI.remainingTrialMs && vitatAI.remainingTrialMs > 0;
    const trialFullyExpired = vitatAI.hasAcceptedTrial && !hasRemainingTime && !isTrialCurrentlyActive && vitatAI.subscriptionStatus !== 'cancelled';

    if (isTrialCurrentlyActive) {
      return res.status(400).json({ message: 'Trial is already active.' });
    }
    if (trialFullyExpired) {
      return res.status(400).json({ message: 'VitatAI trial has already been fully used. Please subscribe to continue.' });
    }
    
    // Save masked card info
    const cleanCard = cardNumber.replace(/\s/g, '');
    const masked = '**** **** **** ' + cleanCard.slice(-4);
    
    if (!user.savedCard) user.savedCard = {};
    user.savedCard.maskedNumber = masked;
    user.savedCard.cardHolder = cardHolder;
    user.savedCard.expiryDate = expiryDate;
    user.savedCard.cardToken = Buffer.from(cleanCard + '|' + cvv + '|' + expiryDate).toString('base64');
    user.savedCard.savedAt = now;
    
    // Determine trial duration: resume remaining or give full 3 days
    let trialDurationMs;
    let isResume = false;
    if (hasRemainingTime) {
      trialDurationMs = vitatAI.remainingTrialMs;
      isResume = true;
    } else {
      trialDurationMs = 3 * 24 * 60 * 60 * 1000; // 3 days
    }

    const trialStart = now;
    const trialEnd = new Date(now.getTime() + trialDurationMs);
    
    user.vitatAI = {
      hasAcceptedTrial: true,
      trialStartDate: vitatAI.trialStartDate || trialStart, // keep original start
      trialEndDate: trialEnd,
      trialCancelledAt: null,
      remainingTrialMs: null, // clear since trial is active again
      isSubscribed: false,
      subscriptionStatus: null,
      additionalTrialDaysGranted: vitatAI.additionalTrialDaysGranted || 7,
      additionalTrialStartDate: vitatAI.additionalTrialStartDate || trialStart,
      additionalTrialEndDate: vitatAI.additionalTrialEndDate || new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    };
    
    // Grant 7-day dashboard trial if not already used
    if (!user.trialUsed) {
      const dashboardTrialEnd = new Date();
      dashboardTrialEnd.setDate(dashboardTrialEnd.getDate() + 7);
      user.trialEndDate = dashboardTrialEnd;
      user.hasAcceptedOffer = true;
      user.offerAcceptedAt = now;
      user.trialUsed = true;
      user.isPaid = false;
    }
    
    await user.save({ validateBeforeSave: false });
    
    const remainingDays = Math.ceil(trialDurationMs / (1000 * 60 * 60 * 24));
    res.json({
      success: true,
      isResume,
      remainingDays,
      message: isResume
        ? `Trial resumed! You have ${remainingDays} day(s) remaining.`
        : 'VitatAI trial activated! You have 3 days to try the chatbot.',
      trialEndDate: trialEnd,
      maskedCard: masked,
      dashboardTrialGranted: !user.trialUsed,
    });
  } catch (error) {
    console.error('Accept VitatAI trial error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Subscribe to VitatAI - charge card and upgrade to paid
router.post('/:id/subscribe', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    if (user.vitatAI?.isSubscribed) {
      return res.status(400).json({ message: 'Already subscribed to VitatAI' });
    }
    
    const { cardNumber, cardHolder, expiryDate, cvv } = req.body;

    // If card data provided, save it; otherwise use existing saved card
    if (cardNumber && cardHolder && expiryDate) {
      const maskedNumber = cardNumber.replace(/\s/g, '').slice(-4).padStart(cardNumber.replace(/\s/g, '').length, '*');
      user.savedCard = {
        maskedNumber: '**** **** **** ' + cardNumber.replace(/\s/g, '').slice(-4),
        cardHolder,
        expiryDate,
      };
    } else if (!user.savedCard || !user.savedCard.maskedNumber) {
      return res.status(400).json({ message: 'No card found. Please provide card details.' });
    }
    
    // TODO: Integrate real payment gateway here
    // For now, simulate successful charge of 30 NIS
    const chargeAmount = 30;
    
    // Set subscription for 30 days from now
    const subStart = new Date();
    const subEnd = new Date();
    subEnd.setDate(subEnd.getDate() + 30);
    
    user.vitatAI = {
      hasAcceptedTrial: user.vitatAI?.hasAcceptedTrial || false,
      trialStartDate: user.vitatAI?.trialStartDate,
      trialEndDate: user.vitatAI?.trialEndDate,
      isSubscribed: true,
      subscriptionStartDate: subStart,
      subscriptionEndDate: subEnd,
      subscriptionStatus: 'active',
      additionalTrialDaysGranted: 7, // Grant 7 additional days for dashboard trial
      additionalTrialStartDate: subStart,
      additionalTrialEndDate: new Date(subStart.getTime() + 7 * 24 * 60 * 60 * 1000),
    };
    
    await user.save({ validateBeforeSave: false });
    
    res.json({
      success: true,
      message: 'VitatAI subscription activated successfully! You also get 7 days of premium dashboard trial.',
      amount: chargeAmount,
      subscriptionEndDate: subEnd,
      maskedCard: user.savedCard.maskedNumber,
      additionalTrialEndDate: user.vitatAI.additionalTrialEndDate,
    });
  } catch (error) {
    console.error('Subscribe VitatAI error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Cancel VitatAI subscription
router.post('/:id/cancel', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const now = new Date();
    const vitatAI = user.vitatAI || {};
    const isTrialActive = vitatAI.hasAcceptedTrial && vitatAI.trialEndDate && now < new Date(vitatAI.trialEndDate);

    if (isTrialActive) {
      // Save how much time is left so user can resume later
      const remainingMs = new Date(vitatAI.trialEndDate) - now;
      user.vitatAI.remainingTrialMs = remainingMs > 0 ? remainingMs : 0;
      user.vitatAI.trialCancelledAt = now;
      user.vitatAI.trialEndDate = now; // effectively ends the trial now
      user.vitatAI.subscriptionStatus = 'cancelled';
    } else {
      // Cancel paid subscription
      user.vitatAI.isSubscribed = false;
      user.vitatAI.subscriptionEndDate = now;
      user.vitatAI.subscriptionStatus = 'cancelled';
    }

    await user.save({ validateBeforeSave: false });

    res.json({ success: true, message: 'VitatAI subscription cancelled' });
  } catch (error) {
    console.error('Cancel VitatAI error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
