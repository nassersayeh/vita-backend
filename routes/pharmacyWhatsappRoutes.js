const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const {
  initializePharmacyWhatsApp,
  sendPharmacyWhatsAppMessage,
  getPharmacyWhatsAppStatus,
  disconnectPharmacyWhatsApp,
  forceDisconnectPharmacyWhatsApp
} = require('../services/whatsappService');

// Get pharmacy WhatsApp status
router.get('/pharmacy/:pharmacyId/whatsapp/status', authMiddleware, async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    if (req.user.role !== 'Admin' && req.user._id.toString() !== pharmacyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const status = getPharmacyWhatsAppStatus(pharmacyId);
    const pharmacy = await User.findById(pharmacyId).select('whatsappSession');
    if (pharmacy && pharmacy.whatsappSession) {
      status.phoneNumber = pharmacy.whatsappSession.phoneNumber;
      status.connectedAt = pharmacy.whatsappSession.connectedAt;
    }

    res.json({ whatsapp: status });
  } catch (error) {
    console.error('Error getting pharmacy WhatsApp status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Initialize/connect pharmacy WhatsApp
router.post('/pharmacy/:pharmacyId/whatsapp/connect', authMiddleware, async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    if (req.user.role !== 'Admin' && req.user._id.toString() !== pharmacyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const pharmacy = await User.findById(pharmacyId);
    if (!pharmacy || pharmacy.role !== 'Pharmacy') {
      return res.status(404).json({ error: 'Pharmacy not found' });
    }

    await initializePharmacyWhatsApp(pharmacyId);

    res.json({ message: 'WhatsApp connection initiated. Please scan the QR code.' });
  } catch (error) {
    console.error('Error initializing pharmacy WhatsApp:', error);
    res.status(500).json({ error: 'Failed to initialize WhatsApp connection' });
  }
});

// Send WhatsApp message from pharmacy to customer
router.post('/pharmacy/:pharmacyId/whatsapp/send-message', authMiddleware, async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { customerPhone, message } = req.body;

    if (req.user.role !== 'Admin' && req.user._id.toString() !== pharmacyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!customerPhone || !message) {
      return res.status(400).json({ error: 'Customer phone and message are required' });
    }

    const result = await sendPharmacyWhatsAppMessage(pharmacyId, customerPhone, message);
    res.json({ success: true, phoneNumber: result.phone });
  } catch (error) {
    console.error('Error sending pharmacy WhatsApp message:', error);
    if (error.message.includes('not ready') || error.message.includes('not registered')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to send WhatsApp message' });
  }
});

// Disconnect
router.post('/pharmacy/:pharmacyId/whatsapp/disconnect', authMiddleware, async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    if (req.user.role !== 'Admin' && req.user._id.toString() !== pharmacyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await disconnectPharmacyWhatsApp(pharmacyId);
    res.json({ message: 'WhatsApp disconnected successfully' });
  } catch (error) {
    console.error('Error disconnecting pharmacy WhatsApp:', error);
    res.status(500).json({ error: 'Failed to disconnect WhatsApp' });
  }
});

// Force disconnect
router.post('/pharmacy/:pharmacyId/whatsapp/force-disconnect', authMiddleware, async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    if (req.user.role !== 'Admin' && req.user._id.toString() !== pharmacyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await forceDisconnectPharmacyWhatsApp(pharmacyId);
    res.json({ message: 'WhatsApp force disconnected and session cleared' });
  } catch (error) {
    console.error('Error force disconnecting pharmacy WhatsApp:', error);
    res.status(500).json({ error: 'Failed to force disconnect WhatsApp' });
  }
});

// Search customers (for sending messages)
router.get('/pharmacy/:pharmacyId/whatsapp/search-customers', authMiddleware, async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { q } = req.query;
    if (req.user.role !== 'Admin' && req.user._id.toString() !== pharmacyId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const rawQ = (q || '').toString().trim();
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(esc(rawQ), 'i');

    // Search saved pharmacy customers and users
    const PharmacyCustomer = require('../models/PharmacyCustomer');
    const customers = await PharmacyCustomer.find({ pharmacyId, $or: [{ name: searchRegex }, { phone: searchRegex }] }).limit(200);
    res.json({ customers });
  } catch (error) {
    console.error('Error searching pharmacy customers for WhatsApp:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
