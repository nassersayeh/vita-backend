const { randomUUID } = require('crypto');
const Event = require('../models/ControlledSecurityEvent');
// Store no patient search terms, request bodies, passwords or tokens.
module.exports = async (req, res, next) => {
  const requestId = randomUUID();
  res.set('X-Request-Id', requestId);
  try {
    await Event.create({ requestId, actor: req.controlledActor.id, role: req.controlledActor.role,
      method: req.method, route: 'request_started' });
  } catch {
    return res.status(503).json({ message: 'خدمة سجل الأمان غير متاحة. يرجى المحاولة لاحقاً.' });
  }
  res.on('finish', () => {
    Event.updateOne({ requestId }, { $set: { status: res.statusCode, route: req.route?.path || 'unmatched',
      recordId: /^[a-f\d]{24}$/i.test(req.params?.id || '') ? req.params.id : undefined,
    } }).catch(() => console.error('[controlled-security] Could not finalize security event', requestId));
  });
  next();
};
