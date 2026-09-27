const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/uploadController');

router.post('/image', require('../middleware/auth'), uploadController.uploadImage, uploadController.handleUpload);

module.exports = router;
