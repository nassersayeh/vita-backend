const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Payment = require('../models/Payment')
const OrderController = require('../controllers/orderController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Drug = require('../models/Drug');
const { extractPrescriptionMedications } = require('../services/aiService');

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

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const simplifyMedicationName = (value = '') => String(value)
  .replace(/\b\d+([.,]\d+)?\s*(mg|mcg|g|ml|iu|٪|%|units?|tab|tabs|tablet|capsule|cap|syrup|inj|injection)\b/gi, ' ')
  .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const findBestDrugMatch = async (medicationName) => {
  const cleanName = simplifyMedicationName(medicationName);
  if (!cleanName || cleanName.length < 2) return null;

  const words = cleanName.split(/\s+/).filter(word => word.length >= 2);
  const mainTerm = words[0] || cleanName;
  const regex = new RegExp(escapeRegex(cleanName), 'i');
  const mainRegex = new RegExp(escapeRegex(mainTerm), 'i');

  const candidates = await Drug.find({
    isActive: true,
    $or: [
      { name: regex },
      { genericName: regex },
      { activeIngredients: { $in: [regex] } },
      { name: mainRegex },
      { genericName: mainRegex }
    ]
  }).limit(10);

  if (!candidates.length) return null;

  const cleanLower = cleanName.toLowerCase();
  const scoreDrug = (drug) => {
    const name = (drug.name || '').toLowerCase();
    const generic = (drug.genericName || '').toLowerCase();
    if (name === cleanLower || generic === cleanLower) return 1;
    if (name.includes(cleanLower) || generic.includes(cleanLower)) return 0.9;
    if (words.length && words.every(word => name.includes(word.toLowerCase()) || generic.includes(word.toLowerCase()))) return 0.75;
    if (name.includes(mainTerm.toLowerCase()) || generic.includes(mainTerm.toLowerCase())) return 0.6;
    return 0.4;
  };

  return candidates
    .map(drug => ({ drug, score: scoreDrug(drug) }))
    .sort((a, b) => b.score - a.score)[0];
};

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

router.post('/analyze-prescription', uploadPrescription.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const fileBuffer = fs.readFileSync(req.file.path);
    const fileData = `data:${req.file.mimetype};base64,${fileBuffer.toString('base64')}`;
    const extraction = await extractPrescriptionMedications({
      fileData,
      fileName: req.file.originalname,
      language: req.body.language || 'ar'
    });

    const matchedMedications = [];
    for (const medication of extraction.medications) {
      const match = await findBestDrugMatch(medication.name);
      matchedMedications.push({
        ...medication,
        matched: !!match,
        matchScore: match?.score || 0,
        drug: match ? {
          _id: match.drug._id,
          name: match.drug.name,
          genericName: match.drug.genericName,
          barcode: match.drug.barcode,
          unitSellingPrice: match.drug.unitSellingPrice || 0,
          dosageForm: match.drug.dosageForm,
          strength: match.drug.strength
        } : null
      });
    }

    res.json({
      success: true,
      prescriptionImage: {
        filename: req.file.filename,
        filePath: req.file.path,
        fileUrl: `${req.protocol}://${req.get('host')}/uploads/prescriptions/${req.file.filename}`,
        uploadedAt: new Date(),
        notes: req.body.notes || ''
      },
      extracted: {
        ...extraction,
        medications: matchedMedications
      }
    });
  } catch (error) {
    console.error('Analyze prescription error:', error);
    res.status(500).json({ message: 'فشل في قراءة الروشيتة', error: error.message });
  }
});

// Create new order
router.post('/', OrderController.createOrder);

// Get pharmacy orders (MUST come before /:orderId routes)
router.get('/pharmacy/:pharmacyId', OrderController.getPharmacyOrders);

// Get medicine orders assigned to admin review
router.get('/admin/all', OrderController.getAdminOrders);

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
