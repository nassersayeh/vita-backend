const generateReferralCode = (userId) => {
    // Generate a unique referral code based on user ID
    return `VITA${userId.toString().slice(-6).toUpperCase()}`;
  };
  
  module.exports = { generateReferralCode };