const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OversightAccount = require('../models/OversightAccount');
module.exports = async (req, res, next) => {
  try {
    if (!process.env.JWT_SECRET) throw new Error('AUTH');
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !/^Bearer [^\s]+$/.test(header)) throw new Error('AUTH');
    const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'], maxAge: '1h' });
    if (!Number.isInteger(decoded.iat) || !Number.isInteger(decoded.exp) || decoded.iat > Math.floor(Date.now() / 1000) + 5) throw new Error('AUTH');
    if (decoded.role === 'oversight') {
      const account = await OversightAccount.findOne({ _id: decoded.accountId, status: 'active' }).select('-password');
      if (!account || (account.passwordChangedAt && decoded.iat * 1000 < account.passwordChangedAt.getTime()) || (decoded.sessionVersion || 0) !== (account.sessionVersion || 0)) throw new Error('AUTH');
      req.controlledActor = { id: account._id, role: account.type, account };
    } else {
      if (!decoded.userId || decoded.accountId || decoded.companyId) throw new Error('AUTH');
      const user = await User.findById(decoded.userId).select('+passwordChangedAt');
      if (!user || user.activationStatus !== 'active' || (user.passwordChangedAt && decoded.iat * 1000 < user.passwordChangedAt.getTime())) throw new Error('AUTH');
      req.controlledActor = { id: user._id, role: user.role, user };
    }
    next();
  } catch { res.status(401).json({ message: 'يرجى تسجيل الدخول مجدداً بحساب فعال.' }); }
};
