const express = require('express');
const router = express.Router();
const sse = require('../services/sseService');

// Subscribe to connection request events for a user
router.get('/requests/:userId', (req, res) => {
  const { userId } = req.params;
  sse.subscribe(userId, res);
});

module.exports = router;
