exports.getCart = async (req, res) => {
  // TODO: Fetch user's cart items
  res.json({ success: true, data: [] });
};

exports.addToCart = async (req, res) => {
  // TODO: Add item to cart
  res.json({ success: true });
};

exports.removeFromCart = async (req, res) => {
  // TODO: Remove item from cart
  res.json({ success: true });
};
