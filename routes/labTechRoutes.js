const express = require('express');
const router = express.Router();
const labTechController = require('../controllers/labTechController');
const authMiddleware = require('../middleware/auth');

// Middleware to verify lab tech role
const verifyLabTechRole = (req, res, next) => {
  if (req.user.role !== 'LabTech') {
    return res.status(403).json({ message: 'Access denied. LabTech role required.' });
  }
  next();
};

// Apply auth middleware to all routes
router.use(authMiddleware);
router.use(verifyLabTechRole);

// Dashboard
router.get('/stats', labTechController.getDashboardStats);

// Lab requests
router.get('/requests', labTechController.getRequests);
router.put('/requests/:requestId', labTechController.updateRequest);

// Medical tests management (CRUD)
router.get('/tests', labTechController.getTests);
router.post('/tests', labTechController.createTest);
router.put('/tests/:testId', labTechController.updateTest);
router.delete('/tests/:testId', labTechController.deleteTest);

module.exports = router;
