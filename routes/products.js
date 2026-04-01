const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const Product = require('../models/Product')
const Order = require('../models/Order')
// GET /api/products?pharmacyId=<pharmacyId>
router.get('/', productController.getProductsByPharmacy);
// GET /api/unique/products?unique=true to fetch unique products
router.get('/unique', async (req, res) => {
  try {
    const { unique } = req.query;
    console.log(unique)
    if (unique) {
      const products = await Product.aggregate([{ $group: { _id: '$name', product: { $first: '$$ROOT' } } }])
        .then(results => results.map(r => r.product));
      return res.status(200).json({ products });
    }
    // Fallback to existing pharmacy-based fetch if not unique
    const { pharmacyId } = req.query;
    if (!pharmacyId) return res.status(400).json({ message: 'Pharmacy ID is required' });
    const products = await Product.find({ pharmacyId });
    res.json({ products });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching products', error });
  }
});

router.post('/', async (req, res) => {
  try {
    const { pharmacyId, name, price, amount, description, image, category } = req.body;
    if (!pharmacyId || !name || !price || !amount) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    const existingProduct = await Product.findOne({ name, pharmacyId });
    if (existingProduct) {
      return res.status(400).json({ message: 'Product with this name already exists for this pharmacy' });
    }
    const product = new Product({
      pharmacyId,
      name,
      price: parseFloat(price),
      amount: parseInt(amount, 10),
      description: description || '',
      image: image || '',
      category: category || 'General',
    });
    await product.save();
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error adding product', error });
  }
});

// router.post('/', async (req, res) => {
//   try {
//     const { pharmacyId, name, price, amount, description, image, category } = req.body;
//     if (!pharmacyId || !name || !price || !amount) {
//       return res.status(400).json({ message: 'Missing required fields' });
//     }
//     const product = new Product({
//       pharmacyId,
//       name,
//       price: parseFloat(price),
//       amount: parseInt(amount, 10),
//       description: description || '',
//       image: image || '',
//       category: category || 'General',
//     });
//     await product.save();
//     res.status(201).json(product);
//   } catch (error) {
//     res.status(500).json({ message: 'Error adding product', error });
//   }
//   });
  // GET product details along with order count
router.get('/:productId', async (req, res) => {
    try {
      const { productId } = req.params;
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ message: 'Product not found.' });
      }
      // Count how many orders reference this product.
      const orderCount = await Order.countDocuments({ productId });
      res.json({ product, orderCount });
    } catch (error) {
      console.error('Error fetching product:', error);
      res.status(500).json({ message: 'Server error while fetching product.' });
    }
  });
  
  // PUT update product details
  router.put('/:productId', async (req, res) => {
    try {
      const { productId } = req.params;
      const updateData = req.body;
      const updatedProduct = await Product.findByIdAndUpdate(productId, { $set: updateData }, { new: true });
      if (!updatedProduct) {
        return res.status(404).json({ message: 'Product not found.' });
      }
      res.json({ message: 'Product updated successfully.', product: updatedProduct });
    } catch (error) {
      console.error('Error updating product:', error);
      res.status(500).json({ message: 'Server error while updating product.' });
    }
  });
  
  // DELETE a product
  router.delete('/:productId', async (req, res) => {
    try {
      const { productId } = req.params;
      const deletedProduct = await Product.findByIdAndDelete(productId);
      if (!deletedProduct) {
        return res.status(404).json({ message: 'Product not found.' });
      }
      res.json({ message: 'Product deleted successfully.' });
    } catch (error) {
      console.error('Error deleting product:', error);
      res.status(500).json({ message: 'Server error while deleting product.' });
    }
  });
module.exports = router;
