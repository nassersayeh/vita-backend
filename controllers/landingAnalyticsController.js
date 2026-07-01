const mongoose = require('mongoose');
const LandingAnalyticsEvent = require('../models/LandingAnalyticsEvent');

const getRequestIp = (req) => {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) return String(forwardedFor).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
};

const parseOccurredAt = (value) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

exports.trackVisit = async (req, res) => {
  try {
    const { visitId, path, referrer, source, language, occurredAt } = req.body || {};

    await LandingAnalyticsEvent.create({
      eventType: 'visit',
      visitId,
      path,
      referrer,
      source,
      language,
      occurredAt: parseOccurredAt(occurredAt),
      userAgent: req.headers['user-agent'] || '',
      ip: getRequestIp(req),
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Landing visit analytics error:', error);
    res.status(500).json({ success: false, message: 'Server error while tracking landing visit' });
  }
};

exports.trackSignup = async (req, res) => {
  try {
    const { visitId, userId, role, country, city, occurredAt } = req.body || {};

    await LandingAnalyticsEvent.create({
      eventType: 'signup',
      visitId,
      userId: mongoose.Types.ObjectId.isValid(userId) ? userId : undefined,
      role,
      country,
      city,
      occurredAt: parseOccurredAt(occurredAt),
      userAgent: req.headers['user-agent'] || '',
      ip: getRequestIp(req),
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Landing signup analytics error:', error);
    res.status(500).json({ success: false, message: 'Server error while tracking landing signup' });
  }
};
