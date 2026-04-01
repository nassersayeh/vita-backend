const Product = require('../models/Product');

exports.getProductsByPharmacy = async (req, res) => {
  try {
    const { pharmacyId } = req.query;
    
    if (!pharmacyId) {
      return res.status(400).json({ message: 'Pharmacy ID is required' });
    }
    
    const products = await Product.find({ pharmacyId });
    
    // Map product fields to frontend expected format
    const mappedProducts = products.map(product => ({
      ...product.toObject(),
      stock: product.amount || 0,
      minStock: product.minStockLevel || 1,  // Default minStock is 1
    }));
    
    res.json({ products: mappedProducts });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};
exports.getProductDetails = async (req, res) => {
  try {
    const productId = req.params.productId;
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    // Count orders that include this product.
    // Adjust the query according to your Order schema.
    const orderCount = await Order.countDocuments({ 'products.product': productId });
    res.json({ product, orderCount });
  } catch (error) {
    console.error('Error fetching product details:', error);
    res.status(500).json({ message: 'Server error' });
  }
};