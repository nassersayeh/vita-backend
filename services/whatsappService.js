const fs = require('fs');
const path = require('path');
const WhatsAppSession = require('../models/WhatsAppSession');

// System WhatsApp socket instance (in-memory, per serverless invocation)
let sock = null;
let isReady = false;
let qrCodeData = null;
let pairingCodeData = null;
let isConnecting = false;

// Pharmacy WhatsApp multi-client support
const pharmacyClients = new Map();

const generatePharmacySessionId = () => {
  return `pharmacy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// ============================================================
// MongoDB-based Auth State (replaces useMultiFileAuthState)
// ============================================================
const useMongoDBAuthState = async (sessionId) => {
  // Load existing session from MongoDB
  let session = await WhatsAppSession.findOne({ sessionId });
  if (!session) {
    session = new WhatsAppSession({ sessionId, creds: null, keys: {} });
    await session.save();
  }

  const creds = session.creds || {};
  const keys = session.keys || {};

  const saveCreds = async () => {
    try {
      await WhatsAppSession.findOneAndUpdate(
        { sessionId },
        { creds, lastActivity: new Date() },
        { upsert: true }
      );
    } catch (err) {
      console.error('Error saving creds to MongoDB:', err.message);
    }
  };

  const saveKeys = async () => {
    try {
      await WhatsAppSession.findOneAndUpdate(
        { sessionId },
        { keys, lastActivity: new Date() },
        { upsert: true }
      );
    } catch (err) {
      console.error('Error saving keys to MongoDB:', err.message);
    }
  };

  const state = {
    creds,
    keys: {
      get: (type, ids) => {
        const data = {};
        for (const id of ids) {
          const value = keys[`${type}-${id}`];
          if (value) {
            data[id] = (type === 'app-state-sync-key') ? 
              // Proto deserialization would happen in baileys
              value : value;
          }
        }
        return data;
      },
      set: async (data) => {
        for (const category in data) {
          for (const id in data[category]) {
            const value = data[category][id];
            const key = `${category}-${id}`;
            if (value) {
              keys[key] = value;
            } else {
              delete keys[key];
            }
          }
        }
        await saveKeys();
      }
    }
  };

  return { state, saveCreds };
};

// Update session status in MongoDB
const updateSessionStatus = async (sessionId, status, extra = {}) => {
  try {
    await WhatsAppSession.findOneAndUpdate(
      { sessionId },
      { status, lastActivity: new Date(), ...extra },
      { upsert: true }
    );
  } catch (err) {
    console.error('Error updating session status in MongoDB:', err.message);
  }
};

// Get session status from MongoDB
const getSessionStatusFromDB = async (sessionId) => {
  try {
    const session = await WhatsAppSession.findOne({ sessionId });
    return session;
  } catch (err) {
    console.error('Error getting session status from MongoDB:', err.message);
    return null;
  }
};

// Clear session from MongoDB
const clearSessionFromDB = async (sessionId) => {
  try {
    await WhatsAppSession.findOneAndUpdate(
      { sessionId },
      { creds: null, keys: {}, status: 'disconnected', disconnectedAt: new Date() },
      { upsert: true }
    );
  } catch (err) {
    console.error('Error clearing session from MongoDB:', err.message);
  }
};

// ============================================================
// Pharmacy WhatsApp (multi-client)
// ============================================================
const initializePharmacyWhatsApp = async (pharmacyId) => {
  const existing = pharmacyClients.get(pharmacyId);
  if (existing && existing.isReady) {
    console.log(`WhatsApp client already initialized for pharmacy ${pharmacyId}`);
    return;
  }

  console.log(`🚀 Initializing WhatsApp client for pharmacy ${pharmacyId}...`);
  const mongoSessionId = `pharmacy_${pharmacyId}`;

  try {
    const {
      makeWASocket,
      DisconnectReason,
      useMultiFileAuthState
    } = await import('@whiskeysockets/baileys');

    // Use MongoDB auth state on Vercel, filesystem locally
    let state, saveCreds;
    if (process.env.VERCEL) {
      ({ state, saveCreds } = await useMongoDBAuthState(mongoSessionId));
    } else {
      const authDir = path.join('./pharmacy_whatsapp_auth', pharmacyId);
      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }
      ({ state, saveCreds } = await useMultiFileAuthState(authDir));
    }

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: [`Vita Pharmacy ${pharmacyId}`, 'Chrome', '1.0.0'],
      version: [2, 3000, 1033893291]
    });

    const sessionId = generatePharmacySessionId();
    pharmacyClients.set(pharmacyId, {
      sock,
      isReady: false,
      qrCodeData: null,
      sessionId,
      reconnectAttempts: existing?.reconnectAttempts || 0
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      const clientData = pharmacyClients.get(pharmacyId);
      if (!clientData) return;

      if (qr) {
        clientData.qrCodeData = qr;
        console.log(`Pharmacy ${pharmacyId} QR code ready.`);
      }
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error instanceof Error) &&
          lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut;
        const isConflict = lastDisconnect?.error?.output?.payload?.data?.tag === 'conflict';
        console.log(`Pharmacy ${pharmacyId} connection closed. Reconnecting: ${shouldReconnect}, Conflict: ${isConflict}`);
        
        await updateSessionStatus(mongoSessionId, 'disconnected', { disconnectedAt: new Date() });
        
        if (shouldReconnect && !isConflict) {
          pharmacyClients.delete(pharmacyId);
          setTimeout(() => initializePharmacyWhatsApp(pharmacyId), 5000);
        } else if (isConflict) {
          clientData.isReady = false;
          pharmacyClients.delete(pharmacyId);
          setTimeout(() => initializePharmacyWhatsApp(pharmacyId), 30000);
        } else {
          clientData.isReady = false;
          pharmacyClients.delete(pharmacyId);
          await updateSessionStatus(mongoSessionId, 'logged_out');
        }
      } else if (connection === 'open') {
        clientData.isReady = true;
        clientData.qrCodeData = null;
        console.log(`Pharmacy ${pharmacyId} WhatsApp client is ready!`);
        await updateSessionStatus(mongoSessionId, 'connected', { connectedAt: new Date() });
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.error(`Failed to initialize WhatsApp client for pharmacy ${pharmacyId}:`, error);
  }
};

const sendPharmacyWhatsAppMessage = async (pharmacyId, mobileNumber, message) => {
  const clientData = pharmacyClients.get(pharmacyId);
  console.log(`Pharmacy WhatsApp client for ${pharmacyId}:`, clientData ? 'found' : 'not found', clientData?.isReady ? 'ready' : 'not ready');

  if (!clientData || !clientData.isReady || !clientData.sock) {
    throw new Error('Pharmacy WhatsApp client is not ready. Please connect WhatsApp first.');
  }
  try {
    let cleanNumber = mobileNumber.replace(/\D/g, '').replace(/^0+/, '');
    if (!cleanNumber.startsWith('970') && !cleanNumber.startsWith('972')) {
      cleanNumber = '970' + cleanNumber;
    }
    const phoneNumber = cleanNumber;
    const jid = `${phoneNumber}@s.whatsapp.net`;
    const isOnWhatsApp = await clientData.sock.onWhatsApp(jid);
    if (!isOnWhatsApp || !isOnWhatsApp[0]?.exists) {
      const altPhoneNumber = phoneNumber.replace(/^970/, '972');
      const altJid = `${altPhoneNumber}@s.whatsapp.net`;
      const isAltOnWhatsApp = await clientData.sock.onWhatsApp(altJid);
      if (isAltOnWhatsApp && isAltOnWhatsApp[0]?.exists) {
        await clientData.sock.sendMessage(altJid, { text: message });
        console.log(`✅ Pharmacy ${pharmacyId} sent WhatsApp message to +${altPhoneNumber}`);
        return { success: true, phone: altPhoneNumber };
      }
      throw new Error('This phone number is not registered on WhatsApp.');
    }
    await clientData.sock.sendMessage(jid, { text: message });
    console.log(`✅ Pharmacy ${pharmacyId} sent WhatsApp message to +${phoneNumber}`);
    return { success: true, phone: phoneNumber };
  } catch (error) {
    console.error(`Pharmacy ${pharmacyId} WhatsApp send error:`, error);
    throw error;
  }
};

const getPharmacyWhatsAppStatus = async (pharmacyId) => {
  // First check in-memory
  const clientData = pharmacyClients.get(pharmacyId);
  if (clientData) {
    return {
      initialized: true,
      ready: clientData.isReady,
      needsQrScan: !!clientData.qrCodeData,
      qrCode: clientData.qrCodeData,
      phoneNumber: null,
      connectedAt: null
    };
  }

  // Fallback: check MongoDB
  const mongoSessionId = `pharmacy_${pharmacyId}`;
  const dbSession = await getSessionStatusFromDB(mongoSessionId);
  if (dbSession && dbSession.status === 'connected') {
    // We have credentials in DB - try to reconnect in background
    return {
      initialized: true,
      ready: true,
      needsQrScan: false,
      qrCode: null,
      phoneNumber: dbSession.phoneNumber,
      connectedAt: dbSession.connectedAt,
      fromDB: true
    };
  }

  return {
    initialized: false,
    ready: false,
    needsQrScan: false,
    qrCode: null,
    phoneNumber: null,
    connectedAt: null
  };
};

const disconnectPharmacyWhatsApp = async (pharmacyId) => {
  const clientData = pharmacyClients.get(pharmacyId);
  if (clientData && clientData.sock) {
    clientData.sock.ev.removeAllListeners();
    clientData.sock = null;
  }
  pharmacyClients.delete(pharmacyId);
  const mongoSessionId = `pharmacy_${pharmacyId}`;
  await updateSessionStatus(mongoSessionId, 'disconnected', { disconnectedAt: new Date() });
  console.log(`Pharmacy ${pharmacyId} WhatsApp disconnected`);
};

const forceDisconnectPharmacyWhatsApp = async (pharmacyId) => {
  await disconnectPharmacyWhatsApp(pharmacyId);
  // Clear auth files
  const authDir = path.join('./pharmacy_whatsapp_auth', pharmacyId);
  if (fs.existsSync(authDir)) {
    fs.rmSync(authDir, { recursive: true, force: true });
  }
  // Clear from MongoDB
  const mongoSessionId = `pharmacy_${pharmacyId}`;
  await clearSessionFromDB(mongoSessionId);
  console.log(`Pharmacy ${pharmacyId} WhatsApp session cleared`);
};

// ============================================================
// System (Admin) WhatsApp
// ============================================================
const SYSTEM_SESSION_ID = 'system';

const initializeWhatsApp = async (pairingPhoneNumber = null) => {
  if (sock && isReady) {
    console.log('WhatsApp client already connected');
    return;
  }

  if (isConnecting) {
    console.log('WhatsApp client is already connecting...');
    return;
  }

  // Clean up existing socket if any
  if (sock) {
    try { sock.ev.removeAllListeners(); } catch (e) {}
    try { sock.end(undefined); } catch (e) {}
    sock = null;
  }

  isConnecting = true;
  isReady = false;
  qrCodeData = null;
  console.log('🚀 Initializing WhatsApp client...');

  try {
    const {
      makeWASocket,
      DisconnectReason,
      useMultiFileAuthState
    } = await import('@whiskeysockets/baileys');

    // Use MongoDB auth state on Vercel, filesystem locally
    let state, saveCreds;
    if (process.env.VERCEL) {
      ({ state, saveCreds } = await useMongoDBAuthState(SYSTEM_SESSION_ID));
    } else {
      const authDir = './baileys_auth';
      ({ state, saveCreds } = await useMultiFileAuthState(authDir));
    }

    const hasCredentials = state.creds && state.creds.me;

    sock = makeWASocket({
      auth: state,
      browser: ['Vita Backend', 'Chrome', '1.0.0'],
      version: [2, 3000, 1033893291]
    });

    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      console.log('📱 WhatsApp connection.update:', { connection, hasQr: !!qr });

      if (qr) {
        qrCodeData = qr;
        console.log('📱 QR code received - scan with WhatsApp to connect');
      }

      if (connection === 'close') {
        isConnecting = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = (lastDisconnect?.error instanceof Error) &&
          statusCode !== DisconnectReason.loggedOut;
        
        const isConflict = lastDisconnect?.error?.output?.payload?.data?.tag === 'conflict';
        const is405 = statusCode === 405;
        const is401 = statusCode === 401;
        
        console.log('Connection closed:', { 
          statusCode, shouldReconnect, isConflict, is405, is401,
          error: lastDisconnect?.error?.message 
        });
        
        if (is405 || is401) {
          console.log('⚠️ WhatsApp session rejected (', statusCode, '). Clearing auth for fresh pairing.');
          await clearSessionFromDB(SYSTEM_SESSION_ID);
          // Also clear local files
          const authPath = process.env.VERCEL ? '/tmp/baileys_auth' : path.join(__dirname, '..', 'baileys_auth');
          if (fs.existsSync(authPath)) {
            try {
              const files = fs.readdirSync(authPath);
              for (const file of files) {
                try { fs.unlinkSync(path.join(authPath, file)); } catch (e) {}
              }
            } catch (e) {}
          }
          sock = null;
          return;
        }
        
        await updateSessionStatus(SYSTEM_SESSION_ID, 'disconnected', { disconnectedAt: new Date() });
        
        if (shouldReconnect && !isConflict) {
          sock = null;
          setTimeout(() => initializeWhatsApp(), 5000);
        } else if (isConflict) {
          console.log('🔄 Conflict detected - waiting 30 seconds before retry...');
          isReady = false;
          sock = null;
          setTimeout(() => initializeWhatsApp(), 30000);
        } else {
          console.log('Connection logged out');
          isReady = false;
          sock = null;
          await updateSessionStatus(SYSTEM_SESSION_ID, 'logged_out');
        }
      } else if (connection === 'open') {
        isReady = true;
        isConnecting = false;
        qrCodeData = null;
        pairingCodeData = null;
        console.log('\n✅ ======================================');
        console.log('   WHATSAPP CLIENT IS READY!');
        console.log('======================================\n');
        console.log('📱 WhatsApp is connected and ready to send messages.');
        
        // Save connected status to MongoDB
        const phoneNumber = state.creds?.me?.id?.split(':')[0] || null;
        await updateSessionStatus(SYSTEM_SESSION_ID, 'connected', { 
          connectedAt: new Date(),
          phoneNumber 
        });
      }
    });

    // Save auth state on updates
    sock.ev.on('creds.update', saveCreds);

    // Handle messages (optional)
    sock.ev.on('messages.upsert', async (m) => {});

  } catch (error) {
    console.error('Failed to initialize WhatsApp client:', error);
    isConnecting = false;
  }
};

// Request a pairing code
const requestWhatsAppPairingCode = async (phoneNumber) => {
  if (isReady) {
    throw new Error('WhatsApp is already connected');
  }

  let cleanNumber = phoneNumber.replace(/\D/g, '').replace(/^0+/, '');
  
  if (cleanNumber.startsWith('970')) {
    cleanNumber = '972' + cleanNumber.slice(3);
  }
  
  if (!cleanNumber.startsWith('972') && cleanNumber.length <= 10) {
    cleanNumber = '972' + cleanNumber;
  }

  // Clean up existing socket
  if (sock) {
    try { sock.ev.removeAllListeners(); } catch (e) {}
    try { sock.end(undefined); } catch (e) {}
    sock = null;
  }
  isConnecting = false;
  pairingCodeData = null;

  // Clear auth for fresh pairing - both MongoDB and filesystem
  await clearSessionFromDB(SYSTEM_SESSION_ID);
  const authPath = process.env.VERCEL ? '/tmp/baileys_auth' : path.join(__dirname, '..', 'baileys_auth');
  if (fs.existsSync(authPath)) {
    try {
      const files = fs.readdirSync(authPath);
      for (const file of files) {
        try { fs.unlinkSync(path.join(authPath, file)); } catch (e) {}
      }
    } catch (e) {}
  }

  await initializeWhatsApp(cleanNumber);

  for (let i = 0; i < 15; i++) {
    if (pairingCodeData) {
      return pairingCodeData;
    }
    if (isReady) {
      throw new Error('WhatsApp connected without needing pairing code');
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error('Pairing code generation timed out. Please try again.');
};

// Format Palestinian phone number
const formatPhoneNumber = (mobileNumber) => {
  let cleanNumber = mobileNumber.replace(/\D/g, '');
  cleanNumber = cleanNumber.replace(/^0+/, '');
  if (cleanNumber.startsWith('970') || cleanNumber.startsWith('972')) {
    return cleanNumber;
  }
  return '970' + cleanNumber;
};

// Send WhatsApp message
const sendWhatsAppMessage = async (mobileNumber, message) => {
  // If not ready in memory, try to reconnect from MongoDB credentials
  if (!isReady || !sock) {
    if (process.env.VERCEL) {
      const dbSession = await getSessionStatusFromDB(SYSTEM_SESSION_ID);
      if (dbSession && dbSession.creds && dbSession.status === 'connected') {
        console.log('📱 Attempting to reconnect WhatsApp from MongoDB credentials...');
        await initializeWhatsApp();
        // Wait up to 10 seconds for connection
        for (let i = 0; i < 10; i++) {
          if (isReady) break;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    if (!isReady || !sock) {
      throw new Error('WhatsApp client is not ready. Please scan the QR code first.');
    }
  }

  try {
    const phoneNumber = formatPhoneNumber(mobileNumber);
    const jid = `${phoneNumber}@s.whatsapp.net`;

    const isOnWhatsApp = await sock.onWhatsApp(jid);
    
    if (!isOnWhatsApp || !isOnWhatsApp[0]?.exists) {
      const altPhoneNumber = phoneNumber.replace(/^970/, '972');
      const altJid = `${altPhoneNumber}@s.whatsapp.net`;
      const isAltOnWhatsApp = await sock.onWhatsApp(altJid);
      
      if (isAltOnWhatsApp && isAltOnWhatsApp[0]?.exists) {
        await sock.sendMessage(altJid, { text: message });
        console.log(`✅ WhatsApp message sent to +${altPhoneNumber}`);
        return { success: true, phone: altPhoneNumber };
      }
      
      throw new Error('This phone number is not registered on WhatsApp.');
    }

    await sock.sendMessage(jid, { text: message });
    console.log(`✅ WhatsApp message sent to +${phoneNumber}`);
    
    // Update last activity
    await updateSessionStatus(SYSTEM_SESSION_ID, 'connected');
    
    return { success: true, phone: phoneNumber };
  } catch (error) {
    console.error('WhatsApp send error:', error);
    throw error;
  }
};

// Send custom WhatsApp message
const sendCustomMessage = async (mobileNumber, customMessage) => {
  let cleanNumber = mobileNumber.replace(/\D/g, '').replace(/^0+/, '');
  if (!cleanNumber.startsWith('970') && !cleanNumber.startsWith('972')) {
    cleanNumber = '970' + cleanNumber;
  }

  const phone970 = cleanNumber.replace(/^972/, '970');
  const phone972 = cleanNumber.replace(/^970/, '972');

  let sentTo = [];
  let errors = [];

  try {
    await sendWhatsAppMessage(phone970, customMessage);
    sentTo.push(phone970);
  } catch (error) {
    errors.push(`+${phone970}: ${error.message}`);
  }

  try {
    await sendWhatsAppMessage(phone972, customMessage);
    sentTo.push(phone972);
  } catch (error) {
    errors.push(`+${phone972}: ${error.message}`);
  }

  if (sentTo.length === 0) {
    throw new Error(`Failed to send WhatsApp message to any number. Errors: ${errors.join('; ')}`);
  }

  return { success: true, sentTo };
};

// Send 2FA verification code
const send2FACode = async (mobileNumber, code, lang = 'en') => {
  let message;
  if (lang === 'ar') {
    message = `🔐 *Vita - رمز الأمان*\n\nرمز التحقق الخاص بك هو: *${code}*\n\nهذا الرمز صالح لمدة 10 دقائق.\n\n⚠️ _لا تشارك هذا الرمز مع أي شخص._`;
  } else {
    message = `🔐 *Vita Security Code*\n\nYour verification code is: *${code}*\n\nThis code will expire in 10 minutes.\n\n⚠️ _Do not share this code with anyone._`;
  }

  let cleanNumber = mobileNumber.replace(/\D/g, '').replace(/^0+/, '');
  if (!cleanNumber.startsWith('970') && !cleanNumber.startsWith('972')) {
    cleanNumber = '970' + cleanNumber;
  }

  const phone970 = cleanNumber.replace(/^972/, '970');
  const phone972 = cleanNumber.replace(/^970/, '972');

  let sentTo = [];
  let errors = [];

  try {
    await sendWhatsAppMessage(phone970, message);
    sentTo.push(phone970);
  } catch (error) {
    errors.push(`+${phone970}: ${error.message}`);
  }

  try {
    await sendWhatsAppMessage(phone972, message);
    sentTo.push(phone972);
  } catch (error) {
    errors.push(`+${phone972}: ${error.message}`);
  }

  if (sentTo.length === 0) {
    throw new Error(`Failed to send WhatsApp message to any number. Errors: ${errors.join('; ')}`);
  }

  return { success: true, sentTo };
};

// Get WhatsApp status - checks BOTH in-memory AND MongoDB
const getWhatsAppStatus = async () => {
  // If in-memory says ready, trust it
  if (isReady && sock) {
    return {
      initialized: true,
      ready: true,
      needsQrScan: false,
      qrCode: null,
      connecting: false
    };
  }

  // If we have a QR code in memory, show it
  if (qrCodeData) {
    return {
      initialized: true,
      ready: false,
      needsQrScan: true,
      qrCode: qrCodeData,
      connecting: isConnecting
    };
  }

  // Fallback: check MongoDB for persisted status
  try {
    const dbSession = await getSessionStatusFromDB(SYSTEM_SESSION_ID);
    if (dbSession) {
      if (dbSession.status === 'connected' && dbSession.creds) {
        // DB says connected and we have creds - report as connected
        // The actual socket might not be alive on this serverless instance,
        // but we know the session is valid
        return {
          initialized: true,
          ready: true,
          needsQrScan: false,
          qrCode: null,
          connecting: false,
          phoneNumber: dbSession.phoneNumber,
          connectedAt: dbSession.connectedAt,
          fromDB: true
        };
      }
      if (dbSession.status === 'connecting') {
        return {
          initialized: true,
          ready: false,
          needsQrScan: false,
          qrCode: null,
          connecting: true
        };
      }
    }
  } catch (err) {
    console.error('Error checking WhatsApp status from DB:', err.message);
  }

  // Default: not connected
  return {
    initialized: !!sock,
    ready: false,
    needsQrScan: !!qrCodeData && !isReady,
    qrCode: qrCodeData,
    connecting: isConnecting
  };
};

// Force reconnect
const forceReconnectWhatsApp = async () => {
  console.log('🔄 Force disconnecting WhatsApp...');
  
  if (sock) {
    try { sock.ev.removeAllListeners(); } catch (e) {}
    try { sock.end(undefined); } catch (e) {}
    sock = null;
  }
  
  isReady = false;
  isConnecting = false;
  qrCodeData = null;
  pairingCodeData = null;
  
  // Clear auth - both MongoDB and filesystem
  await clearSessionFromDB(SYSTEM_SESSION_ID);
  
  const authPath = process.env.VERCEL ? '/tmp/baileys_auth' : path.join(__dirname, '..', 'baileys_auth');
  if (fs.existsSync(authPath)) {
    console.log('🗑️ Clearing WhatsApp auth files...');
    try {
      const files = fs.readdirSync(authPath);
      for (const file of files) {
        try { fs.unlinkSync(path.join(authPath, file)); } catch (e) {}
      }
    } catch (e) {}
  }
  
  console.log('✅ WhatsApp session cleared. Re-initializing...');
  
  await initializeWhatsApp();
  
  for (let i = 0; i < 20; i++) {
    if (qrCodeData) {
      console.log('📱 QR code is ready after force reconnect');
      return;
    }
    if (isReady) {
      console.log('✅ WhatsApp reconnected without needing QR');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('⚠️ QR code not received within timeout');
};

module.exports = {
  initializeWhatsApp,
  sendWhatsAppMessage,
  send2FACode,
  sendCustomMessage,
  getWhatsAppStatus,
  forceReconnectWhatsApp,
  requestWhatsAppPairingCode,
  isWhatsAppReady: () => isReady,
  // Pharmacy multi-client exports
  initializePharmacyWhatsApp,
  sendPharmacyWhatsAppMessage,
  getPharmacyWhatsAppStatus,
  disconnectPharmacyWhatsApp,
  forceDisconnectPharmacyWhatsApp
};
