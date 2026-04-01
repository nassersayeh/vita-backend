const Points = require('../models/Points');
const User = require('../models/User');

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

    // Check for monthly bonus (once per month)
    const lastMonthBonus = points.lastMonthlyBonusDate ? new Date(points.lastMonthlyBonusDate) : null;
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const lastBonusMonth = lastMonthBonus ? lastMonthBonus.getMonth() : -1;
    const lastBonusYear = lastMonthBonus ? lastMonthBonus.getFullYear() : -1;

    if (lastBonusMonth !== currentMonth || lastBonusYear !== currentYear) {
      // Award 10 points for monthly bonus
      points.totalPoints += 10;
      points.lastMonthlyBonusDate = new Date();
      points.pointsHistory.push({
        points: 10,
        action: 'monthly_bonus',
        description: 'Monthly login bonus'
      });
    }

    await points.save();

    // Update user's total points
    user.totalPoints = points.totalPoints;
    await user.save({ validateBeforeSave: false });

    res.json({
      message: 'Daily login points awarded',
      pointsEarned: pointsToAdd,
      totalPoints: points.totalPoints,
      streak: points.dailyLoginStreak,
      monthlyBonusAwarded: lastBonusMonth !== currentMonth || lastBonusYear !== currentYear
    });

  } catch (error) {
    console.error('Daily login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Spin wheel functionality (every 48 hours, 1-10 points weighted to 1)
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
    
    // Check if 48 hours have passed
    if (lastSpin) {
      const hoursSinceLastSpin = (now - lastSpin) / (1000 * 60 * 60);
      if (hoursSinceLastSpin < 48) {
        const hoursRemaining = Math.ceil(48 - hoursSinceLastSpin);
        return res.status(400).json({ 
          message: 'Spin wheel not available yet',
          hoursRemaining,
          nextSpinAvailable: new Date(lastSpin.getTime() + 48 * 60 * 60 * 1000)
        });
      }
    }

    // Spin wheel rewards: heavily weighted towards 1 point, max 10
    // Distribution: 1 appears 80% of the time, 2-5 appear 15%, 6-10 appear 5%
    const rand = Math.random();
    let pointsWon;
    if (rand < 0.80) {
      pointsWon = 1;
    } else if (rand < 0.95) {
      pointsWon = Math.floor(Math.random() * 4) + 2; // 2-5
    } else {
      pointsWon = Math.floor(Math.random() * 5) + 6; // 6-10
    }

    points.totalPoints += pointsWon;
    points.spinWheelLastUsed = now;
    
    points.pointsHistory.push({
      points: pointsWon,
      action: 'spin_wheel',
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
      nextSpinAvailable: new Date(now.getTime() + 48 * 60 * 60 * 1000)
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
    const canSpinWheel = !lastSpin || (now - lastSpin) >= (48 * 60 * 60 * 1000);

    res.json({
      totalPoints: points.totalPoints,
      dailyLoginStreak: points.dailyLoginStreak,
      pointsHistory: points.pointsHistory.slice(-20), // Last 20 entries
      canSpinWheel,
      nextSpinAvailable: lastSpin ? new Date(lastSpin.getTime() + 48 * 60 * 60 * 1000) : null
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
