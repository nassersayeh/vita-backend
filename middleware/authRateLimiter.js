const buckets = new Map();

const normalizeKeyPart = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '');

const getClientIp = (req) => normalizeKeyPart(
  req.ip || req.socket?.remoteAddress || 'unknown'
);

const getMobile = (req) => normalizeKeyPart(
  req.body?.mobile || req.body?.mobileNumber || req.body?.phone || req.body?.userId || 'unknown'
);

const getUsername = (req) => normalizeKeyPart(req.body?.username || 'unknown');

const cleanupExpiredBuckets = (now) => {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  while (buckets.size > 20000) {
    buckets.delete(buckets.keys().next().value);
  }
};

const createRateLimiter = ({ name, windowMs, max, key }) => (req, res, next) => {
  const now = Date.now();
  cleanupExpiredBuckets(now);
  const bucketKey = `${name}:${key(req)}`;
  const current = buckets.get(bucketKey);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;

  bucket.count += 1;
  buckets.set(bucketKey, bucket);

  if (bucket.count > max) {
    res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
    return res.status(429).json({ message: 'Too many attempts. Please try again later.' });
  }
  return next();
};

const byIp = (name, windowMs, max) => createRateLimiter({ name, windowMs, max, key: getClientIp });
const byAccount = (name, windowMs, max) => createRateLimiter({ name, windowMs, max, key: getMobile });
const byUsername = (name, windowMs, max) => createRateLimiter({ name, windowMs, max, key: getUsername });

module.exports = {
  signupLimiters: [byIp('signup-ip', 60 * 60 * 1000, 8)],
  usernameCheckLimiters: [
    byIp('username-check-ip', 15 * 60 * 1000, 60),
    byUsername('username-check-value', 15 * 60 * 1000, 10),
  ],
  loginLimiters: [
    byIp('login-ip', 15 * 60 * 1000, 30),
    byAccount('login-account', 15 * 60 * 1000, 12),
  ],
  forgotPasswordLimiters: [
    byIp('forgot-ip', 60 * 60 * 1000, 20),
    byAccount('forgot-account', 60 * 60 * 1000, 5),
  ],
  resetCodeLimiters: [
    byIp('reset-ip', 15 * 60 * 1000, 30),
    byAccount('reset-account', 15 * 60 * 1000, 8),
  ],
  phoneVerificationLimiters: [
    byIp('phone-verification-ip', 15 * 60 * 1000, 30),
    byAccount('phone-verification-account', 15 * 60 * 1000, 8),
  ],
  resendVerificationLimiters: [
    byIp('resend-verification-ip', 60 * 60 * 1000, 20),
    byAccount('resend-verification-account', 60 * 60 * 1000, 5),
  ],
};
