const Otp = require('../models/Otp');

exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    console.log(otp)
    const otpRecord = await Otp.findOne({ email, otp });
    console.log(otpRecord)
    if (!otpRecord) return res.status(400).json({ message: 'Invalid OTP.' });
    // Remove OTP records for this email
    await Otp.deleteMany({ email });
    res.json({ message: 'OTP verified successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error during OTP verification.' });
  }
};
