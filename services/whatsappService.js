const fs = require('fs');
const path = require('path');

// System WhatsApp socket instance
let sock = null;
let isReady = false;
let qrCodeData = null;
let pairingCodeData = null;
let isConnecting = false;

// Pharmacy WhatsApp multi-client support
const pharmacyClients = new Map(); // pharmacyId -> { sock, isReady, qrCodeData, sessionId }

const generatePharmacySessionId = () => {
  return `pharmacy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Initialize WhatsApp client for a specific pharmacy
const initializePharmacyWhatsApp = async (pharmacyId) => {
  const existing = pharmacyClients.get(pharmacyId);
  if (existing && existing.isReady) {
    console.log(`WhatsApp client already initialized for pharmacy ${pharmacyId}`);
    return;
  }

  console.log(`🚀 Initializing WhatsApp client for pharmacy ${pharmacyId}...`);

  try {
    const {
      makeWASocket,
      DisconnectReason,
      useMultiFileAuthState
    } = await import('@whiskeysockets/baileys');

    // Create pharmacy-specific auth directory
    const authDir = path.join('./pharmacy_whatsapp_auth', pharmacyId);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

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
        }
      } else if (connection === 'open') {
        clientData.isReady = true;
        clientData.qrCodeData = null;
        console.log(`Pharmacy ${pharmacyId} WhatsApp client is ready!`);
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.error(`Failed to initialize WhatsApp client for pharmacy ${pharmacyId}:`, error);
  }
};

// Send WhatsApp message from pharmacy
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

// Get pharmacy WhatsApp status
const getPharmacyWhatsAppStatus = (pharmacyId) => {
  const clientData = pharmacyClients.get(pharmacyId);

  if (!clientData) {
    return {
      initialized: false,
      ready: false,
      needsQrScan: false,
      qrCode: null,
      phoneNumber: null,
      connectedAt: null
    };
  }

  return {
    initialized: true,
    ready: clientData.isReady,
    needsQrScan: !!clientData.qrCodeData,
    qrCode: clientData.qrCodeData,
    phoneNumber: null, // Could be stored in DB if needed
    connectedAt: null
  };
};

// Disconnect pharmacy WhatsApp
const disconnectPharmacyWhatsApp = async (pharmacyId) => {
  const clientData = pharmacyClients.get(pharmacyId);
  if (clientData && clientData.sock) {
    clientData.sock.ev.removeAllListeners();
    clientData.sock = null;
  }
  pharmacyClients.delete(pharmacyId);
  console.log(`Pharmacy ${pharmacyId} WhatsApp disconnected`);
};

// Force disconnect pharmacy WhatsApp
const forceDisconnectPharmacyWhatsApp = async (pharmacyId) => {
  await disconnectPharmacyWhatsApp(pharmacyId);
  // Clear auth files
  const authDir = path.join('./pharmacy_whatsapp_auth', pharmacyId);
  if (fs.existsSync(authDir)) {
    fs.rmSync(authDir, { recursive: true, force: true });
  }
  console.log(`Pharmacy ${pharmacyId} WhatsApp session cleared`);
};

// Initialize WhatsApp client
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

    // Use multi file auth state - on Vercel use /tmp (only writable dir)
    const authDir = process.env.VERCEL ? '/tmp/baileys_auth' : './baileys_auth';
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    // Check if we have existing credentials (already paired before)
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
          // 405/401 means session rejected - clear auth and wait for new pairing
          console.log('⚠️ WhatsApp session rejected (', statusCode, '). Clearing auth for fresh pairing.');
          // Clear auth files
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
      }
    });

    // Save auth state on updates
    sock.ev.on('creds.update', saveCreds);

    // Handle messages (optional, for future use)
    sock.ev.on('messages.upsert', async (m) => {
      // Handle incoming messages if needed
    });

  } catch (error) {
    console.error('Failed to initialize WhatsApp client:', error);
    isConnecting = false;
  }
};

// Request a pairing code for phone number (creates fresh socket with pairing)
const requestWhatsAppPairingCode = async (phoneNumber) => {
  if (isReady) {
    throw new Error('WhatsApp is already connected');
  }

  // Format phone number - for pairing, WhatsApp needs the number exactly as registered
  // Palestinian numbers: WhatsApp uses 972 (not 970)
  // Remove all non-digit characters and leading zeros
  let cleanNumber = phoneNumber.replace(/\D/g, '').replace(/^0+/, '');
  
  // Convert 970 prefix to 972 (WhatsApp uses 972 for Palestinian numbers)
  if (cleanNumber.startsWith('970')) {
    cleanNumber = '972' + cleanNumber.slice(3);
  }
  
  // If no country code, default to 972
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

  // Clear auth files for fresh pairing
  const authPath = process.env.VERCEL ? '/tmp/baileys_auth' : path.join(__dirname, '..', 'baileys_auth');
  if (fs.existsSync(authPath)) {
    try {
      const files = fs.readdirSync(authPath);
      for (const file of files) {
        try { fs.unlinkSync(path.join(authPath, file)); } catch (e) {}
      }
    } catch (e) {}
  }

  // Initialize with pairing phone number
  await initializeWhatsApp(cleanNumber);

  // Wait for pairing code to be generated (up to 15 seconds)
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
  // Remove any non-digit characters
  let cleanNumber = mobileNumber.replace(/\D/g, '');
  
  // Remove leading zeros
  cleanNumber = cleanNumber.replace(/^0+/, '');
  
  // If starts with 970 or 972, keep it
  if (cleanNumber.startsWith('970') || cleanNumber.startsWith('972')) {
    return cleanNumber;
  }
  
  // Palestinian numbers: try 970 first (more common for local numbers)
  // Format: 970 + 5X XXX XXXX (9 digits after country code)
  return '970' + cleanNumber;
};

// Send WhatsApp message
const sendWhatsAppMessage = async (mobileNumber, message) => {
  if (!isReady || !sock) {
    throw new Error('WhatsApp client is not ready. Please scan the QR code first.');
  }

  try {
    // Format phone number for WhatsApp
    const phoneNumber = formatPhoneNumber(mobileNumber);
    const jid = `${phoneNumber}@s.whatsapp.net`;

    // Check if number is on WhatsApp
    const isOnWhatsApp = await sock.onWhatsApp(jid);
    
    if (!isOnWhatsApp || !isOnWhatsApp[0]?.exists) {
      // Try with +972 if +970 doesn't work
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
    return { success: true, phone: phoneNumber };
  } catch (error) {
    console.error('WhatsApp send error:', error);
    throw error;
  }
};

// Send custom WhatsApp message
const sendCustomMessage = async (mobileNumber, customMessage) => {
  // Clean the mobile number
  let cleanNumber = mobileNumber.replace(/\D/g, '').replace(/^0+/, '');
  
  // Ensure it has country code
  if (!cleanNumber.startsWith('970') && !cleanNumber.startsWith('972')) {
    cleanNumber = '970' + cleanNumber; // Default to 970
  }

  // Prepare both versions
  const phone970 = cleanNumber.replace(/^972/, '970');
  const phone972 = cleanNumber.replace(/^970/, '972');

  let sentTo = [];
  let errors = [];

  // Try sending to +970
  try {
    await sendWhatsAppMessage(phone970, customMessage);
    sentTo.push(phone970);
    console.log(`✅ Custom WhatsApp message sent to +${phone970}`);
  } catch (error) {
    console.log(`❌ Failed to send to WhatsApp +${phone970}: ${error.message}`);
    errors.push(`+${phone970}: ${error.message}`);
  }

  // Try sending to +972
  try {
    await sendWhatsAppMessage(phone972, customMessage);
    sentTo.push(phone972);
    console.log(`✅ Custom WhatsApp message sent to +${phone972}`);
  } catch (error) {
    console.log(`❌ Failed to send to WhatsApp +${phone972}: ${error.message}`);
    errors.push(`+${phone972}: ${error.message}`);
  }

  if (sentTo.length === 0) {
    throw new Error(`Failed to send WhatsApp message to any number. Errors: ${errors.join('; ')}`);
  }

  return { success: true, sentTo };
};

// Send 2FA verification code (bilingual) - sends to both +970 and +972
const send2FACode = async (mobileNumber, code, lang = 'en') => {
  let message;
  if (lang === 'ar') {
    message = `🔐 *Vita - رمز الأمان*\n\nرمز التحقق الخاص بك هو: *${code}*\n\nهذا الرمز صالح لمدة 10 دقائق.\n\n⚠️ _لا تشارك هذا الرمز مع أي شخص._`;
  } else {
    message = `🔐 *Vita Security Code*\n\nYour verification code is: *${code}*\n\nThis code will expire in 10 minutes.\n\n⚠️ _Do not share this code with anyone._`;
  }

  // Clean the mobile number
  let cleanNumber = mobileNumber.replace(/\D/g, '').replace(/^0+/, '');
  
  // Ensure it has country code
  if (!cleanNumber.startsWith('970') && !cleanNumber.startsWith('972')) {
    cleanNumber = '970' + cleanNumber; // Default to 970
  }

  // Prepare both versions
  const phone970 = cleanNumber.replace(/^972/, '970');
  const phone972 = cleanNumber.replace(/^970/, '972');

  let sentTo = [];
  let errors = [];

  // Try sending to +970
  try {
    await sendWhatsAppMessage(phone970, message);
    sentTo.push(phone970);
    console.log(`✅ Verification code sent to WhatsApp +${phone970}`);
  } catch (error) {
    console.log(`❌ Failed to send to WhatsApp +${phone970}: ${error.message}`);
    errors.push(`+${phone970}: ${error.message}`);
  }

  // Try sending to +972
  try {
    await sendWhatsAppMessage(phone972, message);
    sentTo.push(phone972);
    console.log(`✅ Verification code sent to WhatsApp +${phone972}`);
  } catch (error) {
    console.log(`❌ Failed to send to WhatsApp +${phone972}: ${error.message}`);
    errors.push(`+${phone972}: ${error.message}`);
  }

  if (sentTo.length === 0) {
    throw new Error(`Failed to send WhatsApp message to any number. Errors: ${errors.join('; ')}`);
  }

  return { success: true, sentTo };
};

// Get WhatsApp status
const getWhatsAppStatus = () => {
  return {
    initialized: !!sock,
    ready: isReady,
    needsQrScan: !!qrCodeData && !isReady,
    qrCode: qrCodeData,
    connecting: isConnecting
  };
};

// Force reconnect WhatsApp (admin function) - clears session for re-pairing
// Returns a promise that resolves once the new QR code is ready (or times out)
const forceReconnectWhatsApp = async () => {
  console.log('🔄 Force disconnecting WhatsApp...');
  
  // Disconnect existing socket
  if (sock) {
    try { sock.ev.removeAllListeners(); } catch (e) {}
    try { sock.end(undefined); } catch (e) {}
    sock = null;
  }
  
  isReady = false;
  isConnecting = false;
  qrCodeData = null;
  pairingCodeData = null;
  
  // Clear auth files to force fresh pairing
  const authPath = process.env.VERCEL ? '/tmp/baileys_auth' : path.join(__dirname, '..', 'baileys_auth');
  if (fs.existsSync(authPath)) {
    console.log('🗑️ Clearing WhatsApp auth files for fresh connection...');
    try {
      const files = fs.readdirSync(authPath);
      for (const file of files) {
        try { fs.unlinkSync(path.join(authPath, file)); } catch (e) {}
      }
      console.log('✅ Auth files cleared successfully');
    } catch (e) {
      console.error('Error clearing auth files:', e.message);
    }
  }
  
  console.log('✅ WhatsApp session cleared. Re-initializing for QR scan...');
  
  // Re-initialize and WAIT for the QR code to arrive (up to 20 seconds)
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
  
  console.log('⚠️ QR code not received within timeout, but socket is initializing');
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
