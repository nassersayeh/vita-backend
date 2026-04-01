const User = require('../models/User');
const multer = require('multer');
const path = require('path');

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Ensure this folder exists
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

// File filter to accept only images
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and GIF images are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limit to 5MB
});

exports.uploadImage = upload.fields([{ name: 'profileImage', maxCount: 1 }]);

exports.handleUpload = async (req, res) => {
  try {
    console.log('Request files:', req.files); // Debug: Check received files
    console.log('Request body:', req.body); // Debug: Check received body

    if (!req.files || !req.files.profileImage || req.files.profileImage.length === 0) {
      return res.status(400).json({ message: 'No file uploaded.' });
    }

    const file = req.files.profileImage[0];
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${file.filename}`; // Image URL

    const userId = req.body.userId;
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required.' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { profileImage: imageUrl },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.json({ message: 'Image uploaded successfully', imageUrl, user: updatedUser });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ message: 'Error uploading image.', error: error.message });
  }
};