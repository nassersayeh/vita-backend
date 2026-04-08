const fs = require('fs');
const path = require('path');
const User = require('../models/User');

// Store active doctor WhatsApp clients
const doctorClients = new Map(); // doctorId -> { sock, isReady, qrCodeData, sessionId }

// Reconnect/backoff settings
const BASE_RECONNECT_MS = 5000; // 5s base
const MAX_RECONNECT_MS = 5 * 60 * 1000; // cap at 5 minutes
const MAX_RECONNECT_ATTEMPTS = 6; // exponent cap (5s,10s,20s,...)
const FINAL_RETRY_LIMIT = 1; // number of extra retries for ambiguous non-recoverable errors

const generateSessionId = () => {
  return `doctor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Initialize WhatsApp client for a specific doctor
const initializeDoctorWhatsApp = async (doctorId) => {
  const existing = doctorClients.get(doctorId);
  // If an initialized & ready client already exists, skip
  if (existing && existing.isReady) {
    console.log(`WhatsApp client already initialized for doctor ${doctorId}`);
    return;
  }

  console.log(`🚀 Initializing WhatsApp client for doctor ${doctorId}...`);

  try {
    const {
      makeWASocket,
      DisconnectReason,
      useMultiFileAuthState,
      fetchLatestBaileysVersion
    } = await import('@whiskeysockets/baileys');

    let waVersion;
    try {
      const { version } = await fetchLatestBaileysVersion();
      waVersion = version;
    } catch (e) {
      waVersion = [2, 3000, 1015901307];
    }

    // Create doctor-specific auth directory
    const authDir = path.join('./doctor_whatsapp_auth', doctorId);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    // Use multi file auth state
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: [`Vita Doctor ${doctorId}`, 'Chrome', '1.0.0'],
      version: waVersion
    });

    const sessionId = generateSessionId();
    doctorClients.set(doctorId, {
      sock,
      isReady: false,
      qrCodeData: null,
      sessionId,
      reconnectAttempts: existing?.reconnectAttempts || 0
    });

    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      let clientData = doctorClients.get(doctorId);
      if (!clientData) {
        // ensure a placeholder exists so reconnect logic can run safely
        doctorClients.set(doctorId, { sock: null, isReady: false, qrCodeData: null, sessionId: null, reconnectAttempts: 0 });
        clientData = doctorClients.get(doctorId);
      }

      console.log(`Doctor ${doctorId} connection update:`, {
        connection,
        hasError: !!lastDisconnect?.error,
        errorMessage: lastDisconnect?.error?.message,
        errorStatus: lastDisconnect?.error?.output?.statusCode,
        hasQr: !!qr
      });

      if (qr) {
        clientData.qrCodeData = qr;
        console.log(`\n📱 ======================================`);
        console.log(`   WHATSAPP QR CODE READY FOR DOCTOR ${doctorId}`);
        console.log(`   Session ID: ${sessionId}`);
        console.log(`======================================\n`);
        console.log('👉 Go to your web app admin panel');
        console.log('👉 Find the WhatsApp Connector section');
        console.log('👉 Scan the QR code displayed there\n');

        // Set QR code expiration timer (5 minutes)
        setTimeout(() => {
          const currentClient = doctorClients.get(doctorId);
          if (currentClient && currentClient.qrCodeData === qr && !currentClient.isReady) {
            console.log(`⏰ QR Code expired for doctor ${doctorId}`);
            currentClient.qrCodeData = null;
            // Don't destroy the client, let it try to reconnect
          }
        }, 5 * 60 * 1000); // 5 minutes
      }

      if (connection === 'close') {
        const error = lastDisconnect?.error;

        // Gather info
        const statusCode = error?.output?.statusCode;
        const errMsg = error?.message || String(error || 'unknown');

        // Classify
        const isRecoverable = (
          statusCode === DisconnectReason.timedOut ||
          statusCode === DisconnectReason.connectionLost ||
          statusCode === DisconnectReason.connectionClosed ||
          statusCode === DisconnectReason.restartRequired ||
          /restart/i.test(errMsg) ||
          statusCode === 515 // stream errored out (restart required)
        );

        const isPermanent = (
          statusCode === DisconnectReason.loggedOut ||
          statusCode === DisconnectReason.badSession ||
          /logout|bad session/i.test(errMsg)
        );

        // Treat 401 / unauthorized as ambiguous (allow a final retry before cleanup)
        const isAmbiguousAuth = statusCode === 401 || /unauthorized/i.test(errMsg);

        console.log(`Doctor ${doctorId} connection closed due to`, errMsg, ', statusCode', statusCode, ', recoverable', isRecoverable, ', permanent', isPermanent);

        // Remove listeners on old socket so re-init can succeed
        if (clientData && clientData.sock) {
          try { clientData.sock.ev.removeAllListeners(); } catch (err) { console.warn(`Error removing listeners for ${doctorId}:`, err); }
          clientData.sock = null;
        }

        // Reconnection/backoff behavior
        clientData.reconnectAttempts = clientData.reconnectAttempts || 0;

        if (isRecoverable) {
          clientData.reconnectAttempts += 1;
          const attempt = Math.min(clientData.reconnectAttempts, MAX_RECONNECT_ATTEMPTS);
          const delay = Math.min(BASE_RECONNECT_MS * Math.pow(2, attempt - 1), MAX_RECONNECT_MS);
          console.log(`🔄 Reconnecting doctor ${doctorId} WhatsApp in ${delay / 1000}s (attempt ${attempt})...`);
          setTimeout(() => initializeDoctorWhatsApp(doctorId), delay);
        } else if ((isAmbiguousAuth || (!isRecoverable && !isPermanent)) && clientData.reconnectAttempts < FINAL_RETRY_LIMIT) {
          clientData.reconnectAttempts += 1;
          console.log(`⚠️ Ambiguous disconnect for ${doctorId}; last retry in ${BASE_RECONNECT_MS / 1000}s`);
          setTimeout(() => initializeDoctorWhatsApp(doctorId), BASE_RECONNECT_MS);
        } else {
          console.log(`❌ Doctor ${doctorId} WhatsApp permanently disconnected`);
          if (clientData) { clientData.isReady = false; clientData.qrCodeData = null; }

          // Clear auth directory on permanent disconnection
          const authDir = path.join('./doctor_whatsapp_auth', doctorId);
          if (fs.existsSync(authDir)) {
            try { fs.rmSync(authDir, { recursive: true, force: true }); console.log(`🗑️ Cleared auth directory for doctor ${doctorId}`); } catch (err) { console.error(`Failed to clear auth dir for ${doctorId}:`, err); }
          }

          // Update database
          await User.findByIdAndUpdate(doctorId, {
            'whatsappSession.isConnected': false,
            'whatsappSession.phoneNumber': null,
            'whatsappSession.connectedAt': null
          });
        }
      } else if (connection === 'open') {
        clientData.isReady = true;
        clientData.qrCodeData = null;

        // Reset reconnect attempts on successful open
        clientData.reconnectAttempts = 0;

        // Get phone number
        const phoneNumber = sock.user?.id?.split('@')[0] || sock.user?.id?.split(':')[0];

        console.log(`\n✅ ======================================`);
        console.log(`   DOCTOR ${doctorId} WHATSAPP IS READY!`);
        console.log(`======================================\n`);
        console.log(`📱 Phone: +${phoneNumber}`);

        // Update database
        await User.findByIdAndUpdate(doctorId, {
          'whatsappSession.isConnected': true,
          'whatsappSession.phoneNumber': phoneNumber,
          'whatsappSession.connectedAt': new Date()
        });
      }
    });

    // Save auth state on updates
    sock.ev.on('creds.update', saveCreds);

  } catch (error) {
    console.error(`Failed to initialize WhatsApp client for doctor ${doctorId}:`, error);
  }
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

// Send WhatsApp message from doctor to patient
const sendDoctorWhatsAppMessage = async (doctorId, patientMobileNumber, message) => {
  // Ensure doctorId is a string
  const doctorIdStr = doctorId.toString();
  const clientData = doctorClients.get(doctorIdStr);

  console.log('sendDoctorWhatsAppMessage called:', {
    doctorId: doctorIdStr,
    hasClientData: !!clientData,
    isReady: clientData?.isReady,
    hasSock: !!clientData?.sock,
    patientMobile: patientMobileNumber
  });

  if (!clientData || !clientData.isReady || !clientData.sock) {
    // Check if doctor has a connected session in DB and try to initialize
    const doctor = await User.findById(doctorIdStr);
    if (doctor?.whatsappSession?.isConnected) {
      console.log('Doctor has connected session in DB but client not ready. Attempting to initialize...');
      await initializeDoctorWhatsApp(doctorIdStr);
      // Wait a bit for initialization
      await new Promise(resolve => setTimeout(resolve, 2000));
      const newClientData = doctorClients.get(doctorIdStr);
      if (!newClientData || !newClientData.isReady) {
        throw new Error('Doctor WhatsApp client failed to initialize. Please reconnect WhatsApp.');
      }
      // Use the newly initialized client
      return sendDoctorWhatsAppMessage(doctorIdStr, patientMobileNumber, message);
    }
    throw new Error('Doctor WhatsApp client is not ready. Please connect WhatsApp first.');
  }

  try {
    const phoneNumber = formatPhoneNumber(patientMobileNumber);
    const jid = `${phoneNumber}@s.whatsapp.net`;

    console.log(`Checking if ${phoneNumber} is on WhatsApp...`);
    
    // Check if number is on WhatsApp
    const isOnWhatsApp = await clientData.sock.onWhatsApp(jid);

    if (!isOnWhatsApp || !isOnWhatsApp[0]?.exists) {
      // Try with +972 if +970 doesn't work
      const altPhoneNumber = phoneNumber.replace(/^970/, '972');
      const altJid = `${altPhoneNumber}@s.whatsapp.net`;
      const isAltOnWhatsApp = await clientData.sock.onWhatsApp(altJid);

      if (isAltOnWhatsApp && isAltOnWhatsApp[0]?.exists) {
        await clientData.sock.sendMessage(altJid, { text: message });
        console.log(`✅ Doctor ${doctorIdStr} sent WhatsApp message to +${altPhoneNumber}`);
        return { success: true, phone: altPhoneNumber };
      }

      throw new Error(`Phone number ${patientMobileNumber} is not registered on WhatsApp.`);
    }

    await clientData.sock.sendMessage(jid, { text: message });
    console.log(`✅ Doctor ${doctorIdStr} sent WhatsApp message to +${phoneNumber}`);
    return { success: true, phone: phoneNumber };
  } catch (error) {
    console.error(`Doctor ${doctorIdStr} WhatsApp send error:`, error.message || error);
    throw error;
  }
};

// Get doctor WhatsApp status
const getDoctorWhatsAppStatus = (doctorId) => {
  const clientData = doctorClients.get(doctorId);

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
    phoneNumber: null, // Will be fetched from DB
    connectedAt: null   // Will be fetched from DB
  };
};

// Disconnect doctor WhatsApp
const disconnectDoctorWhatsApp = async (doctorId) => {
  const clientData = doctorClients.get(doctorId);

  if (clientData) {
    if (clientData.sock) {
      clientData.sock.ev.removeAllListeners();
    }

    doctorClients.delete(doctorId);

    // Update database
    await User.findByIdAndUpdate(doctorId, {
      'whatsappSession.isConnected': false,
      'whatsappSession.phoneNumber': null,
      'whatsappSession.connectedAt': null
    });

    // Remove auth directory
    const authDir = path.join('./doctor_whatsapp_auth', doctorId);
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }

    console.log(`Doctor ${doctorId} WhatsApp disconnected`);
  }
};

// Force disconnect and clear session even if client wasn't initialized
const forceDisconnectDoctorWhatsApp = async (doctorId) => {
  const clientData = doctorClients.get(doctorId);

  if (clientData) {
    if (clientData.sock) {
      try {
        clientData.sock.ev.removeAllListeners();
      } catch (err) {
        console.warn(`Error removing listeners for doctor ${doctorId}:`, err);
      }
    }

    doctorClients.delete(doctorId);
  }

  // Remove auth directory even if client didn't exist
  const authDir = path.join('./doctor_whatsapp_auth', doctorId);
  if (fs.existsSync(authDir)) {
    try {
      fs.rmSync(authDir, { recursive: true, force: true });
      console.log(`🗑️ Cleared auth directory for doctor ${doctorId} (force)`);
    } catch (err) {
      console.error(`Failed to clear auth directory for doctor ${doctorId} (force):`, err);
    }
  }

  // Update database to reflect disconnection
  try {
    await User.findByIdAndUpdate(doctorId, {
      'whatsappSession.isConnected': false,
      'whatsappSession.phoneNumber': null,
      'whatsappSession.connectedAt': null
    });
  } catch (err) {
    console.error(`Failed to update DB for doctor ${doctorId} during force disconnect:`, err);
  }

  console.log(`Doctor ${doctorId} WhatsApp forcefully disconnected`);
};

// Get all connected doctors' WhatsApp info
const getAllDoctorWhatsAppStatuses = async () => {
  const doctors = await User.find({
    role: 'Doctor',
    'whatsappSession.isConnected': true
  }).select('_id fullName whatsappSession');

  return doctors.map(doctor => ({
    doctorId: doctor._id,
    fullName: doctor.fullName,
    phoneNumber: doctor.whatsappSession.phoneNumber,
    connectedAt: doctor.whatsappSession.connectedAt
  }));
};

module.exports = {
  initializeDoctorWhatsApp,
  sendDoctorWhatsAppMessage,
  getDoctorWhatsAppStatus,
  disconnectDoctorWhatsApp,
  forceDisconnectDoctorWhatsApp,
  getAllDoctorWhatsAppStatuses
};