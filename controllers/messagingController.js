const Message = require('../models/Message');
const Clinic = require('../models/Clinic');
const User = require('../models/User');

// Helper: Get the clinic for any clinic member (owner, doctor, staff)
const getClinicForUser = async (userId, userRole) => {
  if (userRole === 'Clinic') {
    return await Clinic.findOne({ ownerId: userId });
  }
  if (userRole === 'Doctor') {
    return await Clinic.findOne({
      'doctors.doctorId': userId,
      'doctors.status': 'active'
    });
  }
  // Staff: Nurse, Accountant, LabTech
  return await Clinic.findOne({
    'staff.userId': userId,
    'staff.status': 'active'
  });
};

// Helper: Get all active members of a clinic
const getClinicMembers = async (clinic) => {
  const memberIds = [];

  // Owner
  memberIds.push(clinic.ownerId.toString());

  // Active doctors
  clinic.doctors
    .filter(d => d.status === 'active')
    .forEach(d => memberIds.push(d.doctorId.toString()));

  // Active staff
  clinic.staff
    .filter(s => s.status === 'active')
    .forEach(s => memberIds.push(s.userId.toString()));

  return memberIds;
};

// GET /messaging/members - List all clinic members you can message
exports.getClinicMembers = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;

    const clinic = await getClinicForUser(userId, userRole);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const memberIds = await getClinicMembers(clinic);

    // Remove the current user from the list
    const otherMemberIds = memberIds.filter(id => id !== userId.toString());

    // Fetch user details
    const members = await User.find({ _id: { $in: otherMemberIds } })
      .select('fullName role profileImage mobileNumber');

    // Map role labels
    const membersWithRole = members.map(m => {
      const member = m.toObject();
      // Determine their specific role in the clinic
      if (member._id.toString() === clinic.ownerId.toString()) {
        member.clinicRole = 'مالك العيادة';
      } else {
        const doctorEntry = clinic.doctors.find(d => d.doctorId.toString() === member._id.toString());
        if (doctorEntry) {
          member.clinicRole = 'طبيب';
        } else {
          const staffEntry = clinic.staff.find(s => s.userId.toString() === member._id.toString());
          if (staffEntry) {
            const roleLabels = { Nurse: 'ممرض/ة', Accountant: 'محاسب', LabTech: 'فني مختبر' };
            member.clinicRole = roleLabels[staffEntry.role] || staffEntry.role;
          }
        }
      }
      return member;
    });

    // Get unread counts per member
    const unreadCounts = await Message.aggregate([
      {
        $match: {
          clinicId: clinic._id,
          receiverId: userId,
          isRead: false
        }
      },
      {
        $group: {
          _id: '$senderId',
          count: { $sum: 1 }
        }
      }
    ]);

    const unreadMap = {};
    unreadCounts.forEach(u => { unreadMap[u._id.toString()] = u.count; });

    // Get last message for each member
    const lastMessages = await Promise.all(
      otherMemberIds.map(async (memberId) => {
        const lastMsg = await Message.findOne({
          clinicId: clinic._id,
          $or: [
            { senderId: userId, receiverId: memberId },
            { senderId: memberId, receiverId: userId }
          ]
        })
          .sort({ createdAt: -1 })
          .select('content createdAt senderId type');
        return { memberId, lastMessage: lastMsg };
      })
    );

    const lastMsgMap = {};
    lastMessages.forEach(lm => {
      if (lm.lastMessage) {
        lastMsgMap[lm.memberId] = lm.lastMessage;
      }
    });

    const result = membersWithRole.map(m => ({
      ...m,
      unreadCount: unreadMap[m._id.toString()] || 0,
      lastMessage: lastMsgMap[m._id.toString()] || null
    }));

    // Sort: unread first, then by last message date
    result.sort((a, b) => {
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
      if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
      const aDate = a.lastMessage?.createdAt || new Date(0);
      const bDate = b.lastMessage?.createdAt || new Date(0);
      return new Date(bDate) - new Date(aDate);
    });

    res.status(200).json({
      success: true,
      clinicName: clinic.name,
      clinicId: clinic._id,
      members: result
    });
  } catch (error) {
    console.error('Error getting clinic members:', error);
    res.status(500).json({ message: 'فشل في جلب أعضاء العيادة', error: error.message });
  }
};

// GET /messaging/conversation/:memberId - Get conversation with a specific member
exports.getConversation = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const { memberId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const clinic = await getClinicForUser(userId, userRole);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    // Verify the other member belongs to the same clinic
    const memberIds = await getClinicMembers(clinic);
    if (!memberIds.includes(memberId)) {
      return res.status(403).json({ message: 'هذا الشخص ليس عضواً في عيادتك' });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const messages = await Message.find({
      clinicId: clinic._id,
      $or: [
        { senderId: userId, receiverId: memberId },
        { senderId: memberId, receiverId: userId }
      ]
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('senderId', 'fullName profileImage role')
      .populate('receiverId', 'fullName profileImage role');

    // Mark unread messages from this member as read
    await Message.updateMany(
      {
        clinicId: clinic._id,
        senderId: memberId,
        receiverId: userId,
        isRead: false
      },
      {
        $set: { isRead: true, readAt: new Date() }
      }
    );

    const total = await Message.countDocuments({
      clinicId: clinic._id,
      $or: [
        { senderId: userId, receiverId: memberId },
        { senderId: memberId, receiverId: userId }
      ]
    });

    // Get the other member's info
    const otherMember = await User.findById(memberId).select('fullName role profileImage');

    res.status(200).json({
      success: true,
      messages: messages.reverse(), // oldest first for chat display
      member: otherMember,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        hasMore: skip + messages.length < total
      }
    });
  } catch (error) {
    console.error('Error getting conversation:', error);
    res.status(500).json({ message: 'فشل في جلب المحادثة', error: error.message });
  }
};

// POST /messaging/send - Send a message
exports.sendMessage = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const { receiverId, content, type = 'text', fileUrl } = req.body;

    if (!receiverId || !content?.trim()) {
      return res.status(400).json({ message: 'يرجى تحديد المستقبل وكتابة الرسالة' });
    }

    const clinic = await getClinicForUser(userId, userRole);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    // Verify the receiver belongs to the same clinic
    const memberIds = await getClinicMembers(clinic);
    if (!memberIds.includes(receiverId)) {
      return res.status(403).json({ message: 'لا يمكنك إرسال رسالة لشخص خارج عيادتك' });
    }

    // Can't message yourself
    if (receiverId === userId.toString()) {
      return res.status(400).json({ message: 'لا يمكنك إرسال رسالة لنفسك' });
    }

    const message = new Message({
      clinicId: clinic._id,
      senderId: userId,
      receiverId,
      content: content.trim(),
      type,
      fileUrl: fileUrl || null
    });

    await message.save();

    // Populate sender info for the response
    await message.populate('senderId', 'fullName profileImage role');
    await message.populate('receiverId', 'fullName profileImage role');

    res.status(201).json({
      success: true,
      message: message
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ message: 'فشل في إرسال الرسالة', error: error.message });
  }
};

// GET /messaging/unread-count - Get total unread messages count
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;

    const clinic = await getClinicForUser(userId, userRole);
    if (!clinic) {
      return res.status(200).json({ count: 0 });
    }

    const count = await Message.countDocuments({
      clinicId: clinic._id,
      receiverId: userId,
      isRead: false
    });

    res.status(200).json({ success: true, count });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ message: 'فشل في جلب عدد الرسائل غير المقروءة', error: error.message });
  }
};

// PUT /messaging/read/:memberId - Mark all messages from a member as read
exports.markAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const { memberId } = req.params;

    const clinic = await getClinicForUser(userId, userRole);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة' });
    }

    const result = await Message.updateMany(
      {
        clinicId: clinic._id,
        senderId: memberId,
        receiverId: userId,
        isRead: false
      },
      {
        $set: { isRead: true, readAt: new Date() }
      }
    );

    res.status(200).json({
      success: true,
      markedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ message: 'فشل في تحديث حالة القراءة', error: error.message });
  }
};

// DELETE /messaging/:messageId - Delete a message (only sender can delete)
exports.deleteMessage = async (req, res) => {
  try {
    const userId = req.user._id;
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'لم يتم العثور على الرسالة' });
    }

    if (message.senderId.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'لا يمكنك حذف رسالة لم ترسلها' });
    }

    await Message.findByIdAndDelete(messageId);

    res.status(200).json({
      success: true,
      message: 'تم حذف الرسالة بنجاح'
    });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ message: 'فشل في حذف الرسالة', error: error.message });
  }
};
