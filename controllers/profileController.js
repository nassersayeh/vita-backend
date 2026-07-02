const User = require('../models/User');
const Notification = require('../models/Notification');

const SUBSCRIPTION_PLANS = {
  core: { name: 'Core System', monthlyPrice: 100, yearlyPrice: 1000 },
  growth: { name: 'Growth + AI', monthlyPrice: 500, yearlyPrice: 5000 },
  premium: { name: 'Premium Media Growth', monthlyPrice: 1500, yearlyPrice: 15000 },
};
const VALID_BILLING_CYCLES = ['monthly', 'yearly'];
const VALID_PAYMENT_METHODS = ['visa', 'cash', 'bank_transfer', 'reflect'];


exports.getProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ message: 'Server error while fetching profile.' });
  }
};
exports.updateProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const { updates } = req.body;

    // Validate that updates is an object
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ message: 'Invalid updates payload.' });
    }

    // Filter out undefined values to prevent overwriting fields with undefined
    const validUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined)
    );

    // Validate specialty against known list if provided and normalize legacy Arabic/key values.
    if (validUpdates.specialty && req.body?.updates) {
      const SPECIALTIES = require('../utils/specialties');
      const specialtyValue = String(validUpdates.specialty).trim();
      const matchedSpecialty = (SPECIALTIES.MAP || []).find((specialty) => (
        specialty.en === specialtyValue
        || specialty.ar === specialtyValue
        || specialty.key === specialtyValue
      ));

      if (!matchedSpecialty && !SPECIALTIES.includes(specialtyValue)) {
        return res.status(400).json({ message: 'Invalid specialty value.' });
      }

      validUpdates.specialty = matchedSpecialty?.en || specialtyValue;
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: validUpdates }, // Spread the updates object directly into $set
      { new: true, runValidators: true } // Ensure validators run and return the updated document
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.json({ message: 'Profile updated', user: updatedUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error updating profile.' });
  }
};
exports.updateActivationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { activationStatus } = req.body; // expected to be 'active' or 'declined'
    
    // Validate the activationStatus value.
    if (!['active', 'declined'].includes(activationStatus)) {
      return res.status(400).json({ message: 'Invalid activation status value.' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: { activationStatus } },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.json({ message: 'Activation status updated successfully.', user: updatedUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error updating activation status.' });
  }
};

exports.requestPlanChange = async (req, res) => {
  try {
    const { id } = req.params;
    const { subscriptionPlan, subscriptionBillingCycle, paymentMethod } = req.body;

    const user = await User.findById(id);
    if (!user || !['Doctor', 'Pharmacy', 'Lab'].includes(user.role)) {
      return res.status(404).json({ message: 'Provider account not found.' });
    }

    const selectedPlan = SUBSCRIPTION_PLANS[subscriptionPlan];
    if (!selectedPlan) {
      return res.status(400).json({ message: 'Please choose a valid subscription plan.' });
    }
    if (!VALID_BILLING_CYCLES.includes(subscriptionBillingCycle)) {
      return res.status(400).json({ message: 'Please choose a valid billing cycle.' });
    }
    if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ message: 'Please choose a valid payment method.' });
    }

    user.planChangeRequest = {
      requestedPlanKey: subscriptionPlan,
      requestedPlanName: selectedPlan.name,
      requestedBillingCycle: subscriptionBillingCycle,
      requestedPrice: subscriptionBillingCycle === 'yearly' ? selectedPlan.yearlyPrice : selectedPlan.monthlyPrice,
      paymentMethod,
      status: 'pending',
      requestedAt: new Date(),
    };

    await user.save({ validateBeforeSave: false });

    try {
      const admins = await User.find({ role: { $in: ['Admin', 'Superadmin'] } }).select('_id').lean();
      if (admins.length) {
        await Notification.insertMany(admins.map((admin) => ({
          user: admin._id,
          type: 'subscription',
          relatedId: user._id,
          message: `${user.fullName || 'A provider'} submitted a subscription renewal/change request for ${selectedPlan.name}.`,
        })));
      }
    } catch (notificationErr) {
      console.error('Failed to notify admins about plan change request:', notificationErr.message);
    }

    const responseUser = user.toObject();
    delete responseUser.password;
    res.json({ message: 'Plan change request saved.', user: responseUser });
  } catch (err) {
    console.error('Plan change request error:', err);
    res.status(500).json({ message: 'Server error while saving plan change request.' });
  }
};
