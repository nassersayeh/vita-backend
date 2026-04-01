const express = require('express');
const router = express.Router();
const ImageRequest = require('../models/ImageRequest');
const Points = require('../models/Points');
const User = require('../models/User');
const multer = require('multer');
const path = require('path');

// Configure multer storage for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/medical-images/'); // Ensure this folder exists
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

// File filter to accept only image files
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/tiff'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, GIF, WEBP, and TIFF images are allowed'), false);
  }
};

const uploadImage = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // Limit to 10MB
});

// Create new image request
router.post('/', async (req, res) => {
  try {
    const { patientId, doctorId, imageType, bodyPart, notes, scheduledDate } = req.body;

    if (!patientId || !doctorId || !imageType) {
      return res.status(400).json({ message: 'Patient, doctor, and image type are required' });
    }

    const imageRequest = new ImageRequest({
      patientId,
      doctorId,
      imageType,
      bodyPart,
      notes,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined
    });

    await imageRequest.save();
    
    // Award 10 points to patient for requesting an image
    try {
      let userPoints = await Points.findOne({ userId: patientId });
      if (!userPoints) {
        userPoints = new Points({ userId: patientId });
      }
      const imagePoints = 10;
      userPoints.totalPoints += imagePoints;
      userPoints.pointsHistory.push({
        points: imagePoints,
        action: 'image',
        description: `Image request points - Request #${imageRequest._id}`,
        referenceId: imageRequest._id
      });
      await userPoints.save();
      const patient = await User.findById(patientId);
      if (patient) {
        patient.totalPoints = userPoints.totalPoints;
        await patient.save({ validateBeforeSave: false });
      }
    } catch (pointsError) {
      console.error('Error awarding image request points:', pointsError);
    }
    
    // Populate the request with user details
    const populatedRequest = await ImageRequest.findById(imageRequest._id)
      .populate('patientId', 'fullName idNumber mobileNumber')
      .populate('doctorId', 'fullName specialty');

    res.status(201).json(populatedRequest);
  } catch (error) {
    console.error('Create image request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get image requests for a specific patient
router.get('/patient/:patientId', async (req, res) => {
  try {
    const { patientId } = req.params;
    const { status, page = 1, limit = 20 } = req.query;

    let filter = { patientId };
    if (status) filter.status = status;

    const requests = await ImageRequest.find(filter)
      .populate('doctorId', 'fullName specialty')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await ImageRequest.countDocuments(filter);

    res.json({
      requests,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get patient image requests error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get specific image request
router.get('/:requestId', async (req, res) => {
  try {
    const request = await ImageRequest.findById(req.params.requestId)
      .populate('patientId', 'fullName idNumber mobileNumber birthdate sex')
      .populate('doctorId', 'fullName specialty');

    if (!request) {
      return res.status(404).json({ message: 'Image request not found' });
    }

    res.json(request);
  } catch (error) {
    console.error('Get image request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update image request status
router.put('/:requestId/status', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, radiologistNotes, findings } = req.body;

    if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const updateData = { status };
    if (radiologistNotes) updateData.radiologistNotes = radiologistNotes;
    if (findings) updateData.findings = findings;
    if (status === 'completed') updateData.completedDate = new Date();

    const request = await ImageRequest.findByIdAndUpdate(
      requestId,
      { $set: updateData },
      { new: true }
    ).populate('patientId', 'fullName')
     .populate('doctorId', 'fullName');

    if (!request) {
      return res.status(404).json({ message: 'Image request not found' });
    }

    res.json(request);
  } catch (error) {
    console.error('Update image request status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Upload image result
router.post('/upload-result', uploadImage.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { patientId, doctorId, imageType, notes, status } = req.body;

    if (!patientId || !doctorId) {
      return res.status(400).json({ message: 'Patient ID and Doctor ID are required' });
    }

    // Create file URL
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/medical-images/${req.file.filename}`;

    // Find the image request for this patient by the doctor (get the most recent pending/in_progress one)
    const imageRequest = await ImageRequest.findOne({
      patientId,
      doctorId,
      status: { $in: ['pending', 'in_progress', 'completed'] }
    }).sort({ createdAt: -1 });

    if (imageRequest) {
      // Add to existing image request
      if (!imageRequest.images) {
        imageRequest.images = [];
      }

      imageRequest.images.push({
        filename: req.file.filename,
        filePath: req.file.path,
        fileUrl: fileUrl,
        notes: notes || ''
      });

      if (status === 'completed') {
        imageRequest.status = 'completed';
        imageRequest.completedDate = new Date();
      }

      await imageRequest.save();
    } else {
      // Create a new image request if none exists
      const newImageRequest = new ImageRequest({
        patientId,
        doctorId,
        imageType: imageType || 'Medical Image',
        status: status || 'completed',
        completedDate: new Date(),
        images: [{
          filename: req.file.filename,
          filePath: req.file.path,
          fileUrl: fileUrl,
          notes: notes || ''
        }]
      });

      await newImageRequest.save();
    }

    const updatedRequest = await ImageRequest.findOne({
      patientId,
      doctorId
    }).sort({ createdAt: -1 })
      .populate('patientId', 'fullName')
      .populate('doctorId', 'fullName');

    res.json({
      message: 'Image uploaded successfully',
      fileUrl: fileUrl,
      request: updatedRequest
    });
  } catch (error) {
    console.error('Upload image result error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete image request
router.delete('/:requestId', async (req, res) => {
  try {
    const request = await ImageRequest.findByIdAndDelete(req.params.requestId);
    if (!request) {
      return res.status(404).json({ message: 'Image request not found' });
    }
    res.json({ message: 'Image request deleted successfully' });
  } catch (error) {
    console.error('Delete image request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
