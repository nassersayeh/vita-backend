// routes/friendRequests.js
const express = require('express');
const router = express.Router();
const friendRequestController = require('../controllers/friendRequestController');

// Doctor sends a friend request: POST /api/friendRequests/:doctorId/send
router.post('/:doctorId/send', friendRequestController.sendFriendRequest);

// Get pending friend requests for a user: GET /api/friendRequests/:userId
router.get('/:userId', friendRequestController.getFriendRequests);
// Get pending requests sent by a user
router.get('/sent/:userId', friendRequestController.getSentRequests);

// Check the status of a friend request: GET /api/friendRequests/status?doctorId=xxx&patientId=xxx
router.get('/status', friendRequestController.getFriendRequestStatus);

// Approve a friend request: PUT /api/friendRequests/:requestId/approve
router.put('/:requestId/approve', friendRequestController.approveFriendRequest);

// Decline a friend request: PUT /api/friendRequests/:requestId/decline
router.put('/:requestId/decline', friendRequestController.declineFriendRequest);

module.exports = router;
