const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Payment = require('../models/Payment')
const OrderController = require('../controllers/orderController');
const multer = require('multer');
const path = require('path');

// Configure multer storage for prescription uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/prescriptions/'); // Ensure this folder exists
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

// File filter to accept PDF and images
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif'
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF and image files are allowed'), false);
  }
};

const uploadPrescription = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // Limit to 10MB
});

// Upload prescription image/PDF for order (MUST come before /:orderId route)
router.post('/upload-prescription', uploadPrescription.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { userId, notes } = req.body;

    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // Create file URL
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/prescriptions/${req.file.filename}`;

    res.json({
      message: 'Prescription uploaded successfully',
      prescriptionImage: {
        filename: req.file.filename,
        filePath: req.file.path,
        fileUrl: fileUrl,
        uploadedAt: new Date(),
        notes: notes || ''
      }
    });
  } catch (error) {
    console.error('Upload prescription error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Create new order
router.post('/', OrderController.createOrder);

// Get pharmacy orders (MUST come before /:orderId routes)
router.get('/pharmacy/:pharmacyId', OrderController.getPharmacyOrders);

// Get all orders for a user
router.get('/user/:userId', OrderController.getUserOrders);

// Get single order by ID
router.get('/:orderId', OrderController.getOrderById);

// Update order status (supports both routes for compatibility)
router.put('/:orderId/status', OrderController.updateOrderStatus);
router.put('/:orderId', OrderController.updateOrderStatus);

// Ask for prescription
router.post('/:orderId/ask-prescription', OrderController.askForPrescription);

// Delete order
router.delete('/:orderId', OrderController.deleteOrder);

module.exports = router;
