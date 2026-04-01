// controllers/usersController.js
const User = require('../models/User');

exports.getPharmacyProfile = async (req, res) => {
  try {
    const { id } = req.params;
    // Find a user with the given ID and ensure the role is Pharmacy
    const pharmacy = await User.findOne({ _id: id, role: 'Pharmacy' });
    if (!pharmacy) {
      return res.status(404).json({ message: 'Pharmacy not found.' });
    }
    // Return all fields for the pharmacy
    res.json({ pharmacy });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error while fetching pharmacy profile.' });
  }
};

