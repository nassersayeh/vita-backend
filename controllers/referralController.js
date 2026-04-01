const mongoose = require('mongoose');
const Referral = require('../models/Referral');
const Points = require('../models/Points');
const User = require('../models/User');
const { generateReferralCode } = require('../utils/referralUtils');

// Get referral stats for a user
const getReferralStats = async (req, res) => {
  try {
    const userId = req.query.userId;
    console.log('getReferralStats userId:', userId); // Debug log
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: `Invalid user ID: ${userId}` });
    }

    const referrals = await Referral.find({ referrerId: userId });
    const totalReferrals = referrals.length;
    const successfulReferrals = referrals.filter(r => r.status === 'completed').length;
    const pendingReferrals = referrals.filter(r => r.status === 'pending').length;
    const totalPointsEarned = referrals.reduce((sum, r) => sum + r.pointsEarned, 0);

    res.status(200).json({
      totalReferrals,
      successfulReferrals,
      pendingReferrals,
      totalPointsEarned
    });
  } catch (error) {
    console.error('Error fetching referral stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get referral history for a user
const getReferralHistory = async (req, res) => {
  try {
    const userId = req.query.userId;
    console.log('getReferralHistory userId:', userId); // Debug log
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: `Invalid user ID: ${userId}` });
    }

    const referrals = await Referral.find({ referrerId: userId })
      .populate('referredId', 'name email')
      .lean();

    const history = referrals.map(referral => ({
      _id: referral._id,
      referredUserName: referral.referredId ? referral.referredId.name : 'Unknown',
      createdAt: referral.createdAt,
      status: referral.status,
      pointsEarned: referral.pointsEarned
    }));

    res.status(200).json(history);
  } catch (error) {
    console.error('Error fetching referral history:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Generate or get referral code for a user
const getReferralCode = async (req, res) => {
  try {
    const userId = req.query.userId;
    console.log('getReferralCode userId:', userId); // Debug log
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: `Invalid user ID: ${userId}` });
    }

    let referral = await Referral.findOne({ referrerId: userId });

    if (!referral) {
      const referralCode = generateReferralCode(userId);
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      referral = new Referral({
        referrerId: userId,
        referralCode,
        status: 'pending'
      });
      await referral.save();
    }

    res.status(200).json({ referralCode: referral.referralCode });
  } catch (error) {
    console.error('Error generating referral code:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Use a referral code
const useReferralCode = async (req, res) => {
  try {
    const { referralCode, userId } = req.body;
    console.log('useReferralCode userId:', userId, 'referralCode:', referralCode); // Debug log
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: `Invalid user ID: ${userId}` });
    }

    // Check if user already used a referral code
    const existingReferral = await Referral.findOne({ referredId: userId });
    if (existingReferral) {
      return res.status(400).json({ message: 'You have already used a referral code' });
    }

    // Find the referral
    const referral = await Referral.findOne({ referralCode });
    if (!referral) {
      return res.status(400).json({ message: 'Invalid referral code' });
    }

    if (referral.referrerId.toString() === userId) {
      return res.status(400).json({ message: 'Cannot use your own referral code' });
    }

    if (referral.status !== 'pending') {
      return res.status(400).json({ message: 'Referral code is no longer valid' });
    }

    // Update referral
    referral.referredId = userId;
    referral.status = 'completed';
    referral.pointsEarned = 10; // Points for friend sign-up
    referral.completedAt = new Date();
    await referral.save();

    // Award points to referrer
    await Points.findOneAndUpdate(
      { userId: referral.referrerId },
      {
        $inc: { totalPoints: 10 },
        $push: {
          pointsHistory: {
            points: 10,
            action: 'referral',
            description: 'Friend signed up using your referral code'
          }
        }
      },
      { upsert: true }
    );

    // Award points to referred user
    await Points.findOneAndUpdate(
      { userId },
      {
        $inc: { totalPoints: 10 },
        $push: {
          pointsHistory: {
            points: 10,
            action: 'referral',
            description: 'Used a referral code during sign-up'
          }
        }
      },
      { upsert: true }
    );

    res.status(200).json({ message: 'Referral code applied successfully' });
  } catch (error) {
    console.error('Error using referral code:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Award referral points for specific actions (e.g., first appointment, first purchase)
const awardReferralPoints = async (req, res) => {
  try {
    const { referredId, action, referrerId } = req.body;
    console.log('awardReferralPoints referrerId:', referrerId, 'referredId:', referredId, 'action:', action); // Debug log
    if (!referrerId || !referredId) {
      return res.status(400).json({ message: 'Referrer ID and referred ID are required' });
    }
    if (!mongoose.Types.ObjectId.isValid(referrerId) || !mongoose.Types.ObjectId.isValid(referredId)) {
      return res.status(400).json({ message: `Invalid user ID: referrerId=${referrerId}, referredId=${referredId}` });
    }

    const referral = await Referral.findOne({ referrerId, referredId, status: 'completed' });
    if (!referral) {
      return res.status(400).json({ message: 'No valid referral found' });
    }

    let points = 0;
    let description = '';

    switch (action) {
      case 'appointment':
        points = 25;
        description = 'Referred friend booked first appointment';
        break;
      case 'purchase':
        points = 15;
        description = 'Referred friend made first purchase';
        break;
      default:
        return res.status(400).json({ message: 'Invalid action' });
    }

    // Update referrer points
    await Points.findOneAndUpdate(
      { userId: referrerId },
      {
        $inc: { totalPoints: points },
        $push: {
          pointsHistory: {
            points,
            action: `referral_${action}`,
            description
          }
        }
      },
      { upsert: true }
    );

    // Update referral points
    referral.pointsEarned += points;
    await referral.save();

    res.status(200).json({ message: 'Referral points awarded successfully' });
  } catch (error) {
    console.error('Error awarding referral points:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getReferralStats,
  getReferralHistory,
  getReferralCode,
  useReferralCode,
  awardReferralPoints
};