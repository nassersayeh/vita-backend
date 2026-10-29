const { catalogCheckoutPricing } = require('../utils/catalogCheckoutPricing');

exports.getPrices = async (req, res) => {
  if (req.user?.role !== 'User') return res.status(403).json({ message: 'Not authorized.' });
  try {
    return res.json({ items: await catalogCheckoutPricing(req.body?.items) });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.status ? error.message : 'Unable to load catalog prices.' });
  }
};
