// controllers/friendRequestController.js
const FriendRequest = require('../models/FriendRequest');
const User = require('../models/User');

exports.sendFriendRequest = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { patientId } = req.body;

    const doctor = await User.findById(doctorId);
    if (!doctor) return res.status(404).json({ message: "Doctor not found." });

    const patient = await User.findById(patientId);
    if (!patient) return res.status(404).json({ message: "Patient not found." });

    // Check if a pending request already exists.
    const existingRequest = await FriendRequest.findOne({ from: doctorId, to: patientId, status: 'pending' });
    if (existingRequest) {
      return res.status(400).json({ message: "Friend request already sent." });
    }

    const friendRequest = new FriendRequest({ from: doctorId, to: patientId });
    await friendRequest.save();
    // Publish SSE event to patient and doctor
    try {
      const sse = require('../services/sseService');
      sse.publish(patientId, 'friendRequestCreated', { type: 'friendRequest', requestId: friendRequest._id });
      sse.publish(doctorId, 'friendRequestCreated', { type: 'friendRequest', requestId: friendRequest._id });
    } catch (err) {
      console.warn('Failed to publish SSE friendRequestCreated', err);
    }
    res.json({ message: "Friend request sent successfully." });
  } catch (error) {
    console.error("Error sending friend request:", error);
    res.status(500).json({ message: "Server error while sending friend request." });
  }
};

exports.getFriendRequests = async (req, res) => {
  try {
    const { userId } = req.params;
    const requests = await FriendRequest.find({ to: userId, status: 'pending' })
      .populate('from', 'fullName profileImage');
    res.json(requests);
  } catch (error) {
    console.error("Error fetching friend requests:", error);
    res.status(500).json({ message: "Server error while fetching friend requests." });
  }
};

// Get requests sent by a user (outgoing pending requests)
exports.getSentRequests = async (req, res) => {
  try {
    const { userId } = req.params;
    const requests = await FriendRequest.find({ from: userId, status: 'pending' })
      .populate('to', 'fullName profileImage');
    res.json(requests);
  } catch (error) {
    console.error("Error fetching sent friend requests:", error);
    res.status(500).json({ message: "Server error while fetching sent friend requests." });
  }
};

exports.getFriendRequestStatus = async (req, res) => {
  try {
    const { doctorId, patientId } = req.query;
    if (!doctorId || !patientId) {
      return res.status(400).json({ message: "Missing doctorId or patientId." });
    }
    const request = await FriendRequest.findOne({ from: doctorId, to: patientId });
    res.json({ status: request ? request.status : "none" });
  } catch (error) {
    console.error("Error fetching friend request status:", error);
    res.status(500).json({ message: "Server error fetching friend request status." });
  }
};

exports.approveFriendRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const friendRequest = await FriendRequest.findById(requestId);
    if (!friendRequest) {
      return res.status(404).json({ message: "Friend request not found." });
    }
    if (friendRequest.status !== 'pending') {
      return res.status(400).json({ message: "Request already processed." });
    }
    friendRequest.status = 'approved';
    await friendRequest.save();

    // Add the patient to the doctor's patients list.
    const doctor = await User.findById(friendRequest.from);
    if (!doctor) {
      return res.status(404).json({ message: "Doctor not found." });
    }
    if (!doctor.patients.includes(friendRequest.to)) {
      doctor.patients.push(friendRequest.to);
      await doctor.save();
    }

    res.json({ message: "Friend request approved and patient added to doctor's list." });
    try {
      const sse = require('../services/sseService');
      sse.publish(friendRequest.to.toString(), 'friendRequestUpdated', { requestId: friendRequest._id, status: 'approved' });
      sse.publish(friendRequest.from.toString(), 'friendRequestUpdated', { requestId: friendRequest._id, status: 'approved' });
    } catch (err) {
      console.warn('Failed to publish SSE friendRequestUpdated', err);
    }
  } catch (error) {
    console.error("Error approving friend request:", error);
    res.status(500).json({ message: "Server error while approving friend request." });
  }
};

exports.declineFriendRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const friendRequest = await FriendRequest.findById(requestId);
    if (!friendRequest) {
      return res.status(404).json({ message: "Friend request not found." });
    }
    friendRequest.status = 'declined';
    await friendRequest.save();
    res.json({ message: "Friend request declined." });
    try {
      const sse = require('../services/sseService');
      sse.publish(friendRequest.from.toString(), 'friendRequestUpdated', { requestId: friendRequest._id, status: 'declined' });
      sse.publish(friendRequest.to.toString(), 'friendRequestUpdated', { requestId: friendRequest._id, status: 'declined' });
    } catch (err) {
      console.warn('Failed to publish SSE friendRequestUpdated', err);
    }
  } catch (error) {
    console.error("Error declining friend request:", error);
    res.status(500).json({ message: "Server error while declining friend request." });
  }
};
