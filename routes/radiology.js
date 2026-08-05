const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const router = express.Router();

// Radiology centers can search their registered patients and add walk-ins.
router.get('/:centerId/patients', async (req, res) => {
  try {
    const patients = await User.find({ role: 'User' })
      .select('fullName mobileNumber idNumber birthdate sex city')
      .sort({ fullName: 1 })
      .limit(500)
      .lean();
    res.json({ patients });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load patients' });
  }
});

router.post('/:centerId/patients', async (req, res) => {
  try {
    const { fullName, mobileNumber, idNumber, password = '123456789', birthdate, sex, address, country = 'Palestine', city } = req.body;
    if (!fullName || !mobileNumber || !idNumber || !address || !city) {
      return res.status(400).json({ message: 'fullName, mobileNumber, idNumber, address, and city are required' });
    }

    let patient = await User.findOne({ $or: [{ mobileNumber }, { idNumber }] });
    if (patient) return res.status(409).json({ message: 'Patient already exists', patient });

    patient = await User.create({
      fullName, mobileNumber, idNumber, birthdate, sex, address, country, city,
      role: 'User', password: await bcrypt.hash(password, 10),
      activationStatus: 'active', isPhoneVerified: true
    });
    res.status(201).json({ patient: { _id: patient._id, fullName: patient.fullName, mobileNumber: patient.mobileNumber, idNumber: patient.idNumber } });
  } catch (error) {
    res.status(500).json({ message: 'Failed to register patient', error: error.message });
  }
});

module.exports = router;
