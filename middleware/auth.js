// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      throw new Error('Authentication required');
    }

    if (!process.env.JWT_SECRET) throw new Error('JWT secret is not configured');
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded.userId || decoded.accountId || decoded.companyId || !Number.isInteger(decoded.iat) || !Number.isInteger(decoded.exp)) throw new Error('Invalid session');
    // Admin routes need identity and current authorization, not the account's
    // patient lists, inventories, or medical history. Still check DB every time.
    const adminRoute = req.baseUrl === '/api/admin' || req.baseUrl?.startsWith('/api/admin/');
    const user = await User.findById(decoded.userId).select(adminRoute
      ? '_id fullName role activationStatus +passwordChangedAt'
      : '+passwordChangedAt');

    if (!user) {
      throw new Error('User not found');
    }
    if (user.passwordChangedAt && decoded.iat * 1000 < user.passwordChangedAt.getTime()) {
      throw new Error('Session expired after password change');
    }
    if (user.activationStatus !== 'active') {
      return res.status(403).json({
        code: user.activationStatus === 'pending' ? 'ACCOUNT_PENDING_APPROVAL' : 'ACCOUNT_INACTIVE',
        message: user.activationStatus === 'pending' ? 'Your account is awaiting admin approval.' : 'Your account is not active.',
      });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    res.status(401).json({ message: 'غير مصرح به: خطأ في المصادقة.' });
  }
};

module.exports = authMiddleware;
