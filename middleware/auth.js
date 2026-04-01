// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      throw new Error('Authentication required');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key'); // Ensure JWT_SECRET is set in .env
    const user = await User.findById(decoded.userId);

    if (!user) {
      throw new Error('User not found');
    }

    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    res.status(401).json({ message: 'غير مصرح به: خطأ في المصادقة.' });
  }
};

module.exports = authMiddleware;