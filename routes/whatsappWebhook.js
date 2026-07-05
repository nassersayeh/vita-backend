const express = require('express');

const router = express.Router();

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  || process.env.WHATSAPP_VERIFY_TOKEN
  || 'vita_whatsapp_webhook_2026';

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WhatsApp Cloud Webhook] Verified successfully');
    return res.status(200).send(challenge);
  }

  console.warn('[WhatsApp Cloud Webhook] Verification failed', {
    mode,
    tokenProvided: Boolean(token),
  });
  return res.sendStatus(403);
});

router.post('/', (req, res) => {
  const payload = req.body;

  if (payload?.object !== 'whatsapp_business_account') {
    return res.sendStatus(404);
  }

  try {
    const entries = Array.isArray(payload.entry) ? payload.entry : [];

    entries.forEach((entry) => {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];

      changes.forEach((change) => {
        const value = change.value || {};
        const messages = Array.isArray(value.messages) ? value.messages : [];
        const statuses = Array.isArray(value.statuses) ? value.statuses : [];

        messages.forEach((message) => {
          console.log('[WhatsApp Cloud Webhook] Incoming message', {
            from: message.from,
            id: message.id,
            type: message.type,
            text: message.text?.body,
            timestamp: message.timestamp,
          });
        });

        statuses.forEach((status) => {
          console.log('[WhatsApp Cloud Webhook] Message status update', {
            recipient: status.recipient_id,
            id: status.id,
            status: status.status,
            timestamp: status.timestamp,
          });
        });
      });
    });
  } catch (error) {
    console.error('[WhatsApp Cloud Webhook] Failed to process payload:', error);
  }

  return res.sendStatus(200);
});

module.exports = router;
