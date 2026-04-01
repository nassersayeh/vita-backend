const ReflectOffer = require('../models/ReflectOffer');

exports.createReflectOffer = async (req, res) => {
    try {
      const { user, fullName, idNumber, phoneNumber, healthInsurance, insuranceCompany } = req.body;
      if (!user || !fullName || !idNumber || !phoneNumber || healthInsurance === undefined) {
        return res.status(400).json({ message: 'All fields are required.' });
      }
      // If the applicant has health insurance, ensure insuranceCompany is provided.
      if (healthInsurance === true && !insuranceCompany) {
        return res.status(400).json({ message: 'Insurance company is required when you have health insurance.' });
      }
      // Check if a request already exists for this user.
      const existing = await ReflectOffer.findOne({ user: req.body.user });
      if (existing && existing.user.toString() === req.body.user.toString()) {
        return res.status(400).json({ message: 'Reflect offer request already exists for this user.' });
      }
      const newOffer = new ReflectOffer({
        user,
        fullName,
        idNumber,
        phoneNumber,
        healthInsurance,
        insuranceCompany: healthInsurance ? insuranceCompany : '',
        status: 'pending',
      });
      await newOffer.save();
      res.status(201).json({ message: 'Reflect offer request created successfully.', offer: newOffer });
    } catch (error) {
      console.error('Error creating reflect offer:', error);
      res.status(500).json({ message: 'Server error while creating reflect offer.' });
    }
  };
  

exports.getReflectOfferForUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const offer = await ReflectOffer.findOne({ user: userId });
    console.log(offer);
    if (!offer) {
      return res.status(404).json({ message: 'No reflect offer request found.' });
    }
    res.json({ offer });
  } catch (error) {
    console.error('Error fetching reflect offer:', error);
    res.status(500).json({ message: 'Server error while fetching reflect offer.' });
  }
};

exports.getReflectOffer = async (req, res) => {
    try {
      const { offerId } = req.params;
      console.log(offerId)
      const offer = await ReflectOffer.findById(offerId);
      console.log("Fetched Offer:", offer);
      if (!offer) {
        return res.status(404).json({ message: 'No reflect offer request found.' });
      }
      res.json({ offer });
    } catch (error) {
      console.error('Error fetching reflect offer:', error);
      res.status(500).json({ message: 'Server error while fetching reflect offer.' });
    }
  };

exports.updateReflectOffer = async (req, res) => {
    try {
      const { offerId } = req.params;
      const { status } = req.body; // Expect one of 'accepted', 'in review', 'declined'
      if (!status || !['accepted', 'in review', 'declined'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status provided.' });
      }
      const updatedOffer = await ReflectOffer.findByIdAndUpdate(
        offerId,
        { $set: { status } },
        { new: true }
      );
      if (!updatedOffer) {
        return res.status(404).json({ message: 'Reflect offer not found.' });
      }
      res.json({ message: 'Reflect offer updated successfully.', offer: updatedOffer });
    } catch (error) {
      console.error('Error updating reflect offer:', error);
      res.status(500).json({ message: 'Server error while updating reflect offer.' });
    }
  };
  exports.getAllReflectOffers = async (req, res) => {
    try {
      // Return all reflect offers, sorted by creation date descending.
      const offers = await ReflectOffer.find().sort({ createdAt: -1 });
      res.json(offers);
    } catch (error) {
      console.error('Error fetching all reflect offers:', error);
      res.status(500).json({ message: 'Server error while fetching reflect offers.' });
    }
  };