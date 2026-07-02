const express = require('express');
const router = express.Router();
const DemoRequest = require('../models/DemoRequest');
const Notification = require('../models/Notification');
const User = require('../models/User');

const cleanText = (value) => String(value || '').trim();

const buildDemoRequestMessage = (request) => {
  const lines = [
    'طلب ديمو جديد من اللاندنج بيج',
    `المؤسسة: ${request.organization}`,
    `الشخص المسؤول: ${request.contact}`,
    `الهاتف: ${request.phone}`,
    `البريد الإلكتروني: ${request.email || 'غير مدخل'}`,
    `الدولة/المدينة: ${request.country}`,
    `نوع الجهة: ${request.type}`,
    `الحجم: ${request.size || 'غير محدد'}`,
    `الوقت المفضل: ${request.time || 'غير محدد'}`,
    `اللغة: ${request.language || 'غير محددة'}`,
  ];

  if (request.message) {
    lines.push(`الرسالة: ${request.message}`);
  }

  if (request.pagePath || request.query || request.source) {
    lines.push(`المصدر: ${request.source || 'request_demo_page'} ${request.pagePath || ''}${request.query || ''}`.trim());
  }

  return lines.join('\n');
};

router.post('/demo-requests', async (req, res) => {
  try {
    const requiredFields = ['organization', 'contact', 'phone', 'country', 'type'];
    const missingFields = requiredFields.filter((field) => !cleanText(req.body?.[field]));

    if (missingFields.length) {
      return res.status(400).json({
        success: false,
        message: 'Missing required demo request fields',
        missingFields,
      });
    }

    const demoRequest = await DemoRequest.create({
      organization: cleanText(req.body.organization),
      contact: cleanText(req.body.contact),
      phone: cleanText(req.body.phone),
      email: cleanText(req.body.email),
      country: cleanText(req.body.country),
      type: cleanText(req.body.type),
      size: cleanText(req.body.size),
      time: cleanText(req.body.time),
      message: cleanText(req.body.message),
      source: cleanText(req.body.source) || 'request_demo_page',
      pagePath: cleanText(req.body.pagePath),
      query: cleanText(req.body.query),
      language: ['ar', 'en'].includes(req.body.language) ? req.body.language : 'en',
      submittedAt: req.body.submittedAt ? new Date(req.body.submittedAt) : new Date(),
    });

    const admins = await User.find({ role: { $in: ['Admin', 'Superadmin'] } }).select('_id').lean();
    if (admins.length) {
      const message = buildDemoRequestMessage(demoRequest);
      await Notification.insertMany(admins.map((admin) => ({
        user: admin._id,
        type: 'request',
        message,
        relatedId: demoRequest._id,
      })));
    }

    res.status(201).json({
      success: true,
      message: 'Demo request received',
      demoRequest,
    });
  } catch (error) {
    console.error('Create demo request error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while creating demo request',
    });
  }
});

module.exports = router;
