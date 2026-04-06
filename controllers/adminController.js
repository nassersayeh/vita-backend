// Get user counts by role
exports.getUserStats = async (req, res) => {
  try {
    const usersByRole = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);
    res.json(usersByRole.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {}));
  } catch (error) {
    res.status(500).json({ message: 'Server error while fetching user stats' });
  }
};

// List users with trial status (active, ended, paid/unpaid)
exports.getTrialUsers = async (req, res) => {
  try {
    const users = await User.find({ role: { $in: ['Doctor', 'Pharmacy', 'Lab', 'Institution', 'Hospital'] } })
      .select('fullName role isPaid trialEndDate createdAt email activationStatus');
    const now = new Date();
    const result = users.map(u => {
      let trialEnded = false;
      if (u.trialEndDate && now > u.trialEndDate) trialEnded = true;
      return {
        id: u._id,
        fullName: u.fullName,
        role: u.role,
        isPaid: u.isPaid,
        trialEndDate: u.trialEndDate,
        createdAt: u.createdAt,
        email: u.email,
        activationStatus: u.activationStatus,
        trialEnded
      };
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Server error while fetching trial users' });
  }
};

// Extend trial for a user
exports.extendTrial = async (req, res) => {
  try {
    const { id } = req.params;
    const { days, months } = req.body;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    // If trial has already ended, extend from now; otherwise extend from current trial end
    const now = new Date();
    let endDate = user.trialEndDate && new Date(user.trialEndDate) > now ? new Date(user.trialEndDate) : new Date();
    if (months) endDate.setMonth(endDate.getMonth() + Number(months));
    if (days) endDate.setDate(endDate.getDate() + Number(days));
    user.trialEndDate = endDate;
    await user.save();
    console.log(`Admin extended trial for user ${user._id}. New trialEndDate: ${user.trialEndDate}`);
    // Notify user
    try {
      const Notification = require('../models/Notification');
      const unitStr = months ? `${months} month${months > 1 ? 's' : ''}` : `${days} day${days > 1 ? 's' : ''}`;
      await Notification.create({
        user: user._id,
        type: 'subscription',
        message: `Your trial was extended by ${unitStr}. New end date: ${new Date(user.trialEndDate).toLocaleDateString()}.`,
      });
    } catch (e) {
      console.error('Failed to create trial extension notification:', e.message);
    }
    res.json({ message: 'Trial extended', trialEndDate: user.trialEndDate, trialActive: new Date(user.trialEndDate) > new Date() });
  } catch (error) {
    res.status(500).json({ message: 'Server error while extending trial' });
  }
};

// Update payment status for a user
exports.updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isPaid, amount, durationUnit, durationValue } = req.body;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.isPaid = !!isPaid;

    // When marking as paid, set subscription details
    if (user.isPaid) {
      const now = new Date();
      let end = new Date(now);
      if (durationUnit && durationValue) {
        if (durationUnit === 'year') {
          end.setFullYear(end.getFullYear() + Number(durationValue));
        } else {
          end.setMonth(end.getMonth() + Number(durationValue));
        }
        user.subscriptionPlanUnit = durationUnit;
        user.subscriptionPlanValue = Number(durationValue);
      } else {
        // default to 1 month if not specified
        end.setMonth(end.getMonth() + 1);
        user.subscriptionPlanUnit = 'month';
        user.subscriptionPlanValue = 1;
      }
      user.subscriptionEndDate = end;
      if (amount != null) user.lastPaymentAmount = Number(amount);
      user.lastPaymentAt = now;
      // also align trialEndDate to subscription end for compatibility consumers
      user.trialEndDate = end;
    } else {
      // If marking as unpaid, clear subscription metadata
      user.subscriptionPlanUnit = null;
      user.subscriptionPlanValue = null;
      user.lastPaymentAmount = null;
      user.lastPaymentAt = null;
      user.subscriptionEndDate = null;
    }

    await user.save();

    // Create a user notification about the change
    try {
      const Notification = require('../models/Notification');
      if (user.isPaid) {
        const amountText = amount != null ? `$${Number(amount).toFixed(2)}` : 'your subscription';
        const planText = `${user.subscriptionPlanValue} ${user.subscriptionPlanUnit}${user.subscriptionPlanValue > 1 ? 's' : ''}`;
        const endText = user.subscriptionEndDate ? new Date(user.subscriptionEndDate).toLocaleDateString() : '';
        await Notification.create({
          user: user._id,
          type: 'payment',
          message: `Subscription activated: ${amountText} for ${planText}. Valid until ${endText}.`,
        });
      } else {
        await Notification.create({
          user: user._id,
          type: 'subscription',
          message: 'Your subscription has been marked as unpaid by admin.',
        });
      }
    } catch (e) {
      console.error('Failed to create payment notification:', e.message);
    }

    res.json({ 
      message: 'Payment status updated', 
      isPaid: user.isPaid,
      subscriptionEndDate: user.subscriptionEndDate,
      subscriptionPlanUnit: user.subscriptionPlanUnit,
      subscriptionPlanValue: user.subscriptionPlanValue,
      lastPaymentAmount: user.lastPaymentAmount,
      lastPaymentAt: user.lastPaymentAt
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error while updating payment status' });
  }
};
const User = require('../models/User');
const AdminNotification = require('../models/AdminNotification');
const Points = require('../models/Points');
const Order = require('../models/Order');
const Appointment = require('../models/Appointment');
const Financial = require('../models/Financial');

// Get pending provider approvals
exports.getPendingApprovals = async (req, res) => {
  try {
    const pendingUsers = await User.find({
      activationStatus: 'pending',
      role: { $in: ['Doctor', 'Pharmacy', 'Lab', 'Institution', 'Hospital'] }
    }).select('-password').sort({ createdAt: -1 });

    res.json(pendingUsers);
  } catch (error) {
    console.error('Get pending approvals error:', error);
    res.status(500).json({ message: 'Server error while fetching pending approvals' });
  }
};

// Approve or reject user
exports.approveUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, adminId, rejectionReason, trialDays } = req.body;

    if (!['active', 'declined'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.activationStatus = status;
    user.approvedBy = adminId;
    user.approvedAt = new Date();

    if (status === 'active' && trialDays && user.role !== 'User') {
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + parseInt(trialDays));
      user.trialEndDate = trialEndDate;
    }

    if (status === 'declined' && rejectionReason) {
      user.rejectionReason = rejectionReason;
    }

    await user.save();

    res.json({
      message: `User ${status === 'active' ? 'approved' : 'rejected'} successfully`,
      user: {
        id: user._id,
        fullName: user.fullName,
        role: user.role,
        activationStatus: user.activationStatus
      }
    });
  } catch (error) {
    console.error('Approve user error:', error);
    res.status(500).json({ message: 'Server error while approving user' });
  }
};

// Get all users with filtering
exports.getAllUsers = async (req, res) => {
  try {
    const { role, status, page = 1, limit = 20, search } = req.query;
    
    let filter = {};
    if (role) filter.role = role;
    if (status) filter.activationStatus = status;
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { idNumber: { $regex: search, $options: 'i' } }
      ];
    }

    // Support fetching all users without pagination when limit === 'all'
    let users;
    let total;
    if (String(limit).toLowerCase() === 'all') {
      users = await User.find(filter)
        .select('-password')
        .sort({ createdAt: -1 });
      total = users.length;
      res.json({
        users,
        totalPages: 1,
        currentPage: 1,
        total
      });
    } else {
      users = await User.find(filter)
        .select('-password')
        .sort({ createdAt: -1 })
        .limit(Number(limit) * 1)
        .skip((Number(page) - 1) * Number(limit));

      total = await User.countDocuments(filter);

      res.json({
        users,
        totalPages: Math.ceil(total / Number(limit)),
        currentPage: Number(page),
        total
      });
    }
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ message: 'Server error while fetching users' });
  }
};

// Send targeted notification
exports.sendNotification = async (req, res) => {
  try {
    const { title, content, targetGroup, targetUsers, adminId } = req.body;

    if (!title || !content || !targetGroup) {
      return res.status(400).json({ message: 'Title, content, and target group are required' });
    }

    const notification = new AdminNotification({
      title,
      content,
      targetGroup,
      targetUsers: targetUsers || [],
      sentBy: adminId
    });

    await notification.save();

    let recipientCount = 0;
    if (targetGroup === 'all') {
      recipientCount = await User.countDocuments({ activationStatus: 'active' });
    } else if (targetUsers && targetUsers.length > 0) {
      recipientCount = targetUsers.length;
    } else {
      const roleMap = {
        'patients': 'User',
        'doctors': 'Doctor',
        'pharmacies': 'Pharmacy',
        'labs': 'Lab'
      };
      recipientCount = await User.countDocuments({ 
        role: roleMap[targetGroup], 
        activationStatus: 'active' 
      });
    }

    notification.deliveryStats.totalSent = recipientCount;
    await notification.save();

    res.json({
      message: 'Notification sent successfully',
      notificationId: notification._id,
      recipientCount
    });
  } catch (error) {
    console.error('Send notification error:', error);
    res.status(500).json({ message: 'Server error while sending notification' });
  }
};

// Get dashboard analytics
exports.getDashboardAnalytics = async (req, res) => {
  try {
    const { period = '30' } = req.query; // days
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    // User statistics
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ activationStatus: 'active' });
    const pendingUsers = await User.countDocuments({ activationStatus: 'pending' });
    
    const usersByRole = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);

    // Recent registrations by role
    const recentRegistrations = await User.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);

    // Appointment statistics
    const totalAppointments = await Appointment.countDocuments();
    const recentAppointments = await Appointment.countDocuments({
      createdAt: { $gte: startDate }
    });

    // Order statistics
    const totalOrders = await Order.countDocuments();
    const recentOrders = await Order.countDocuments({
      createdAt: { $gte: startDate }
    });

    // Revenue from orders
    const orderRevenue = await Order.aggregate([
      { $match: { createdAt: { $gte: startDate }, status: { $ne: 'cancelled' } } },
      { $group: { _id: null, totalRevenue: { $sum: '$total' } } }
    ]);

    // Revenue from provider subscriptions (paid users)
    const subscriptionRevenue = await User.aggregate([
      { 
        $match: { 
          isPaid: true, 
          lastPaymentAt: { $gte: startDate },
          lastPaymentAmount: { $exists: true, $ne: null }
        } 
      },
      { $group: { _id: null, totalRevenue: { $sum: '$lastPaymentAmount' } } }
    ]);

    // Total revenue = orders + subscriptions
    const totalRevenue = (orderRevenue[0]?.totalRevenue || 0) + (subscriptionRevenue[0]?.totalRevenue || 0);

    // Points statistics
    const totalPointsAwarded = await Points.aggregate([
      { $group: { _id: null, total: { $sum: '$totalPoints' } } }
    ]);

    // Financial overview
    const financialOverview = await Financial.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$totalEarnings' },
          totalExpenses: { $sum: '$totalExpenses' }
        }
      }
    ]);

    res.json({
      users: {
        total: totalUsers,
        active: activeUsers,
        pending: pendingUsers,
        byRole: usersByRole.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {}),
        recentRegistrations: recentRegistrations.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {})
      },
      appointments: {
        total: totalAppointments,
        recent: recentAppointments
      },
      orders: {
        total: totalOrders,
        recent: recentOrders,
        revenue: totalRevenue,
        orderRevenue: orderRevenue[0]?.totalRevenue || 0,
        subscriptionRevenue: subscriptionRevenue[0]?.totalRevenue || 0
      },
      points: {
        totalAwarded: totalPointsAwarded[0]?.total || 0
      },
      financial: financialOverview[0] || { totalEarnings: 0, totalExpenses: 0 }
    });
  } catch (error) {
    console.error('Get dashboard analytics error:', error);
    res.status(500).json({ message: 'Server error while fetching analytics' });
  }
};

// Get notification history
exports.getNotificationHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const notifications = await AdminNotification.find()
      .populate('sentBy', 'fullName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await AdminNotification.countDocuments();

    res.json({
      notifications,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
      autograph
    });
  } catch (error) {
    console.error('Get notification history error:', error);
    res.status(500).json({ message: 'Server error while fetching notification history' });
  }
};

// Delete user (admin only)
exports.deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { adminId } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'Admin') {
      return res.status(403).json({ message: 'Cannot delete admin users' });
    }

    await User.findByIdAndDelete(userId);

    await Points.deleteOne({ userId });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error while deleting user' });
  }
};

// Create a new user (admin only)
exports.createUser = async (req, res) => {
  try {
    const userData = req.body;
    const bcrypt = require('bcryptjs');
    
    const existingUser = await User.findOne({ 
      $or: [{ email: userData.email }, { mobileNumber: userData.mobileNumber }, { idNumber: userData.idNumber }] 
    });
    
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email, mobile number, or ID already exists' });
    }

    // Hash password before saving
    if (userData.password) {
      const salt = await bcrypt.genSalt(10);
      userData.password = await bcrypt.hash(userData.password, salt);
    }

    const newUser = new User(userData);
    await newUser.save();

    res.status(201).json({ message: 'User created successfully', user: { id: newUser._id, fullName: newUser.fullName, role: newUser.role } });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: 'Server error while creating user' });
  }
};

// Get user by ID
exports.getUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({ message: 'Server error while fetching user' });
  }
};

// Update user data
exports.updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const updateData = req.body;
    const bcrypt = require('bcryptjs');
    
    // Handle password: hash if provided, otherwise remove from update
    if (updateData.password && updateData.password.trim()) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(updateData.password.trim(), salt);
    } else {
      delete updateData.password;
    }
    
    const user = await User.findByIdAndUpdate(userId, { $set: updateData }, { new: true, runValidators: true }).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User updated successfully', user });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error while updating user' });
  }
};

// Get revenue by specific month
exports.getRevenueByMonth = async (req, res) => {
  try {
    const { year, month } = req.params;
    
    // Calculate date range for the month
    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59);

    // Order revenue for the month
    const orderRevenue = await Order.aggregate([
      { 
        $match: { 
          createdAt: { $gte: startDate, $lte: endDate },
          status: { $ne: 'cancelled' }
        } 
      },
      { $group: { _id: null, totalRevenue: { $sum: '$total' } } }
    ]);

    res.json({
      year: Number(year),
      month: Number(month),
      orderRevenue: orderRevenue[0]?.totalRevenue || 0,
    });
  } catch (error) {
    console.error('Get revenue by month error:', error);
    res.status(500).json({ message: 'Server error while fetching revenue' });
  }
};

// Gift points to multiple users
exports.giftPoints = async (req, res) => {
  const Notification = require('../models/Notification');
  const Points = require('../models/Points');
  const { sendCustomMessage, isWhatsAppReady } = require('../services/whatsappService');
  
  try {
    const { userIds, points, message } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: 'Please select at least one user' });
    }
    
    if (!points || points <= 0) {
      return res.status(400).json({ message: 'Points must be a positive number' });
    }
    
    const results = {
      success: [],
      failed: []
    };
    
    for (const userId of userIds) {
      try {
        // Get user details
        const user = await User.findById(userId);
        if (!user) {
          console.error(`User ${userId} not found`);
          results.failed.push(userId);
          continue;
        }

        // Find or create Points record
        let pointsRecord = await Points.findOne({ userId });
        if (!pointsRecord) {
          pointsRecord = new Points({ userId, totalPoints: 0 });
        }
        
        // Add points
        pointsRecord.totalPoints += points;
        pointsRecord.pointsHistory.push({
          points: points,
          action: 'admin_gift',
          description: message || 'Free points gift from Vita',
          date: new Date()
        });
        await pointsRecord.save();
        
        // Update user's total points
        await User.findByIdAndUpdate(userId, { 
          $inc: { totalPoints: points } 
        });
        
        // Create notification for the user
        const notification = new Notification({
          user: userId,
          type: 'points_gift',
          message: message || `🎁 You received ${points} free points as a gift!`,
          isRead: false
        });
        await notification.save();
        
        // Send WhatsApp message
        const { getWhatsAppStatus } = require('../services/whatsappService');
        const whatsappStatus = getWhatsAppStatus();
        console.log(`Checking WhatsApp for user ${userId}: status=${JSON.stringify(whatsappStatus)}, mobileNumber=${user.mobileNumber}`);
        if (whatsappStatus.ready && whatsappStatus.initialized && user.mobileNumber) {
          try {
            let whatsappMessage = `🎉 تهانينا! لقد حصلت على ${points} نقطة كـ${message || 'نقاط ترحيبية مجانية'}!\n\n`;
            
            if (!user.isPhoneVerified) {
              whatsappMessage += `⚠️ يرجى تسجيل الدخول والتحقق من رقم هاتفك للحصول على النقاط المجانية الآن!`;
            }
            
            console.log(`Sending WhatsApp message to ${user.mobileNumber}: ${whatsappMessage}`);
            await sendCustomMessage(user.mobileNumber, whatsappMessage);
            console.log(`WhatsApp message sent successfully to user ${userId} for ${points} points`);
          } catch (whatsappError) {
            console.error(`Failed to send WhatsApp message to user ${userId}:`, whatsappError.message);
            // Don't fail the whole operation if WhatsApp fails
          }
        } else {
          console.log(`Skipping WhatsApp for user ${userId}: isReady=${isWhatsAppReady()}, hasMobile=${!!user.mobileNumber}`);
        }
        
        results.success.push(userId);
      } catch (err) {
        console.error(`Failed to gift points to user ${userId}:`, err);
        results.failed.push(userId);
      }
    }
    
    res.json({
      message: `Successfully gifted ${points} points to ${results.success.length} user(s)`,
      success: results.success.length,
      failed: results.failed.length,
      results
    });
  } catch (error) {
    console.error('Gift points error:', error);
    res.status(500).json({ message: 'Server error while gifting points' });
  }
};

// Search users for gift points (lightweight endpoint)
exports.searchUsersForGift = async (req, res) => {
  try {
    const { search, role } = req.query;
    
    let query = {};
    
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { mobileNumber: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (role && role !== 'all') {
      query.role = role;
    }
    
    const users = await User.find(query)
      .select('_id fullName mobileNumber email role totalPoints profileImage')
      .limit(50)
      .sort({ fullName: 1 });
    
    res.json(users);
  } catch (error) {
    console.error('Search users for gift error:', error);
    if (error && error.stack) {
      console.error(error.stack);
    }
    res.status(500).json({ message: 'Server error while searching users', error: error.message });
  }
};