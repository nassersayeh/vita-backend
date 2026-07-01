const Points = require('../models/Points');
const User = require('../models/User');
const PointSettings = require('../models/PointSettings');

// Award daily login points
exports.dailyLogin = async (req, res) => {
  try {
    const userId = req.user._id; // Get from authenticated user
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let points = await Points.findOne({ userId });
    if (!points) {
      points = new Points({ userId });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day
    const lastLogin = points.lastLoginDate ? new Date(points.lastLoginDate) : null;
    lastLogin?.setHours(0, 0, 0, 0);
    
    // Check if user already logged in today
    if (lastLogin && lastLogin.getTime() === today.getTime()) {
      return res.json({ 
        message: 'Already logged in today', 
        points: points.totalPoints,
        streak: points.dailyLoginStreak 
      });
    }

    // Check if login streak continues
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (lastLogin && lastLogin.getTime() === yesterday.getTime()) {
      points.dailyLoginStreak += 1;
    } else {
      points.dailyLoginStreak = 1;
    }

    // Award 1 point per day
    const pointsToAdd = 1;
    points.totalPoints += pointsToAdd;
    points.lastLoginDate = new Date();
    
    points.pointsHistory.push({
      points: pointsToAdd,
      action: 'daily_login',
      description: `Daily login (Day ${points.dailyLoginStreak})`
    });

    await points.save();

    // Update user's total points
    user.totalPoints = points.totalPoints;
    await user.save({ validateBeforeSave: false });

    res.json({
      message: 'Daily login points awarded',
      pointsEarned: pointsToAdd,
      totalPoints: points.totalPoints,
      streak: points.dailyLoginStreak,
      monthlyBonusAwarded: false
    });

  } catch (error) {
    console.error('Daily login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Spin wheel functionality (every 24 hours, 1-3 points daily, 5 points once per month)
exports.spinWheel = async (req, res) => {
  try {
    const userId = req.user._id; // Get from authenticated user
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let points = await Points.findOne({ userId });
    if (!points) {
      points = new Points({ userId });
    }

    const now = new Date();
    const lastSpin = points.spinWheelLastUsed;
    
    // Check if 24 hours have passed
    if (lastSpin) {
      const hoursSinceLastSpin = (now - lastSpin) / (1000 * 60 * 60);
      if (hoursSinceLastSpin < 24) {
        const hoursRemaining = Math.ceil(24 - hoursSinceLastSpin);
        return res.status(400).json({ 
          message: 'Spin wheel not available yet',
          hoursRemaining,
          nextSpinAvailable: new Date(lastSpin.getTime() + 24 * 60 * 60 * 1000)
        });
      }
    }

    const lastFivePointWheelDate = points.lastFivePointWheelDate ? new Date(points.lastFivePointWheelDate) : null;
    const fivePointBonusUsedThisMonth = lastFivePointWheelDate
      && lastFivePointWheelDate.getMonth() === now.getMonth()
      && lastFivePointWheelDate.getFullYear() === now.getFullYear();
    const prizePool = fivePointBonusUsedThisMonth ? [1, 1, 2, 2, 3, 3] : [1, 1, 2, 2, 3, 3, 5];
    const pointsWon = prizePool[Math.floor(Math.random() * prizePool.length)];

    points.totalPoints += pointsWon;
    points.spinWheelLastUsed = now;
    if (pointsWon === 5) {
      points.lastFivePointWheelDate = now;
    }
    
    points.pointsHistory.push({
      points: pointsWon,
      action: pointsWon === 5 ? 'monthly_wheel_bonus' : 'spin_wheel',
      description: `Spin wheel reward - ${pointsWon} point${pointsWon > 1 ? 's' : ''}`
    });

    await points.save();

    // Update user's total points
    user.totalPoints = points.totalPoints;
    await user.save({ validateBeforeSave: false });

    res.json({
      message: 'Spin wheel completed',
      pointsWon,
      totalPoints: points.totalPoints,
      nextSpinAvailable: new Date(now.getTime() + 24 * 60 * 60 * 1000)
    });

  } catch (error) {
    console.error('Spin wheel error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Award points for specific actions (order, appointment, test, image)
// Points awarded:
// - Order: points = order total price (e.g., $100 order = 100 points)
// - Appointment: 10 points
// - Test/Lab Request: 10 points
// - Image Request: 10 points
exports.awardPoints = async (req, res) => {
  try {
    const userId = req.user._id; // Get from authenticated user
    const { action, points: pointsToAdd, description, referenceId } = req.body;

    if (!action || pointsToAdd === undefined) {
      return res.status(400).json({ message: 'action and points are required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let points = await Points.findOne({ userId });
    if (!points) {
      points = new Points({ userId });
    }

    const numPoints = Number(pointsToAdd);
    if (isNaN(numPoints) || numPoints < 0) {
      return res.status(400).json({ message: 'Points must be a non-negative number' });
    }

    points.totalPoints += numPoints;
    
    points.pointsHistory.push({
      points: numPoints,
      action,
      description: description || `Points for ${action}`,
      referenceId: referenceId || null
    });

    await points.save();

    // Update user's total points
    user.totalPoints = points.totalPoints;
    await user.save({ validateBeforeSave: false });

    res.json({
      message: `Points awarded for ${action}`,
      pointsEarned: numPoints,
      totalPoints: points.totalPoints
    });

  } catch (error) {
    console.error('Award points error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Legacy: Award action points (kept for backward compatibility)
exports.awardActionPoints = async (req, res) => {
  return exports.awardPoints(req, res);
};

exports.getPointSettings = async (req, res) => {
  try {
    const settings = await PointSettings.findOneAndUpdate(
      { key: 'default' },
      { $setOnInsert: { pointValueIls: 0.1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({
      pointValueIls: settings.pointValueIls,
      updatedAt: settings.updatedAt,
    });
  } catch (error) {
    console.error('Get point settings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get user points and history (enhanced version)
exports.getUserPointsNew = async (req, res) => {
  try {
    const userId = req.params.userId || req.user._id; // Use param or authenticated user
    
    const points = await Points.findOne({ userId }).populate('userId', 'fullName');
    if (!points) {
      return res.json({
        totalPoints: 0,
        dailyLoginStreak: 0,
        pointsHistory: [],
        canSpinWheel: true
      });
    }

    const now = new Date();
    const lastSpin = points.spinWheelLastUsed;
    const canSpinWheel = !lastSpin || (now - lastSpin) >= (24 * 60 * 60 * 1000);

    res.json({
      totalPoints: points.totalPoints,
      dailyLoginStreak: points.dailyLoginStreak,
      pointsHistory: points.pointsHistory.slice(-20), // Last 20 entries
      canSpinWheel,
      nextSpinAvailable: lastSpin ? new Date(lastSpin.getTime() + 24 * 60 * 60 * 1000) : null
    });

  } catch (error) {
    console.error('Get user points error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get points leaderboard
exports.getLeaderboard = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    const leaderboard = await Points.find()
      .populate('userId', 'fullName profileImage')
      .sort({ totalPoints: -1 })
      .limit(parseInt(limit));

    const formattedLeaderboard = leaderboard.map((entry, index) => ({
      rank: index + 1,
      userId: entry.userId._id,
      fullName: entry.userId.fullName,
      profileImage: entry.userId.profileImage,
      totalPoints: entry.totalPoints,
      dailyLoginStreak: entry.dailyLoginStreak
    }));

    res.json(formattedLeaderboard);

  } catch (error) {
    console.error('Get leaderboard error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Legacy functions for backward compatibility
exports.getUserPoints = async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(userId)
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    // If points is null, default to 0
    const points = user.totalPoints || 0;
    res.json({ points });
  } catch (error) {
    console.error("Error fetching user points:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateUserPoints = async (req, res) => {
  try {
    const { userId } = req.params;
    let { spinnerResult } = req.body;
    
    // Ensure spinnerResult is a number
    spinnerResult = Number(spinnerResult);
    if (isNaN(spinnerResult)) {
      return res.status(400).json({ message: "spinnerResult must be a number" });
    }
    
    // Use findOneAndUpdate with an aggregation pipeline update.
    // This sets points to (if points is null then 0 else points) + spinnerResult.
    const updatedUser = await User.findOneAndUpdate(
      { _id: userId },
      [
        { 
          $set: { 
            totalPoints: { 
              $add: [ { $ifNull: ["$totalPoints", 0] }, spinnerResult ] 
            } 
          } 
        }
      ],
      { new: true }
    );
    
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ points: updatedUser.totalPoints });
  } catch (error) {
    console.error("Error updating user points:", error);
    res.status(500).json({ message: "Server error" });
  }
};
