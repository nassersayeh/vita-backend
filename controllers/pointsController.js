const User = require('../models/User');

exports.getUserPoints = async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(userId)
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    // If points is null, default to 0
    const points = user.points || 0;
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
            points: { 
              $add: [ { $ifNull: ["$points", 0] }, spinnerResult ] 
            } 
          } 
        }
      ],
      { new: true }
    );
    
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ points: updatedUser.points });
  } catch (error) {
    console.error("Error updating user points:", error);
    res.status(500).json({ message: "Server error" });
  }
};
