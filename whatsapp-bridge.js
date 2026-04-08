#!/usr/bin/env node
/**
 * WhatsApp Bridge - Standalone Process
 * 
 * هاد السكربت بيشتغل على جهازك (أو أي سيرفر) كـ process دائم.
 * بيربط WhatsApp ويخزن الـ session والـ QR بالـ MongoDB.
 * الـ Vercel backend بيقرأ منه.
 * 
 * Usage:
 *   node whatsapp-bridge.js
 * 
 * Or keep it running with pm2:
 *   npx pm2 start whatsapp-bridge.js --name whatsapp-bridge
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

// Import the WhatsAppSession model
const WhatsAppSession = require('./models/WhatsAppSession');

const SYSTEM_SESSION_ID = 'system';

let sock = null;
let isReady = false;
let isConnecting = false;

// Connect to MongoDB
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
}

// Initialize WhatsApp
async function initializeWhatsApp() {
  if (sock && isReady) {
    console.log('WhatsApp already connected');
    return;
  }
  if (isConnecting) {
    console.log('Already connecting...');
    return;
  }

  if (sock) {
    try { sock.ev.removeAllListeners(); } catch (e) {}
    try { sock.end(undefined); } catch (e) {}
    sock = null;
  }

  isConnecting = true;
  isReady = false;

  console.log('🚀 Initializing WhatsApp client...');

  try {
    const {
      makeWASocket,
      DisconnectReason,
      useMultiFileAuthState
    } = await import('@whiskeysockets/baileys');

    const authDir = path.join(__dirname, 'baileys_auth');
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      browser: ['Vita Backend', 'Chrome', '1.0.0'],
      version: [2, 3000, 1033893291]
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      console.log('📱 Connection update:', { connection, hasQr: !!qr });

      if (qr) {
        console.log('📱 QR Code received! Saving to MongoDB...');
        // Store QR in MongoDB so Vercel can read it
        try {
          await WhatsAppSession.findOneAndUpdate(
            { sessionId: SYSTEM_SESSION_ID },
            { 
              status: 'waiting_qr', 
              qrCode: qr, 
              lastActivity: new Date() 
            },
            { upsert: true }
          );
          console.log('✅ QR code saved to MongoDB - visible on admin panel now!');
        } catch (e) {
          console.error('Failed to save QR to MongoDB:', e.message);
        }
      }

      if (connection === 'close') {
        isConnecting = false;
        isReady = false;
        sock = null;

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = (lastDisconnect?.error instanceof Error) &&
          statusCode !== DisconnectReason.loggedOut;
        
        console.log('Connection closed:', { statusCode, shouldReconnect });

        await WhatsAppSession.findOneAndUpdate(
          { sessionId: SYSTEM_SESSION_ID },
          { status: 'disconnected', qrCode: null, disconnectedAt: new Date() },
          { upsert: true }
        );

        if (statusCode === 405 || statusCode === 401) {
          console.log('⚠️ Session rejected. Clearing auth...');
          // Clear auth files
          if (fs.existsSync(authDir)) {
            const files = fs.readdirSync(authDir);
            for (const file of files) {
              try { fs.unlinkSync(path.join(authDir, file)); } catch (e) {}
            }
          }
          await WhatsAppSession.findOneAndUpdate(
            { sessionId: SYSTEM_SESSION_ID },
            { creds: null, keys: {}, status: 'disconnected', qrCode: null },
            { upsert: true }
          );
          // Retry after 5 seconds
          setTimeout(() => initializeWhatsApp(), 5000);
        } else if (shouldReconnect) {
          setTimeout(() => initializeWhatsApp(), 5000);
        } else {
          console.log('❌ Logged out permanently');
          await WhatsAppSession.findOneAndUpdate(
            { sessionId: SYSTEM_SESSION_ID },
            { status: 'logged_out', qrCode: null },
            { upsert: true }
          );
        }
      } else if (connection === 'open') {
        isReady = true;
        isConnecting = false;

        const phoneNumber = state.creds?.me?.id?.split(':')[0] || null;

        console.log('\n✅ ======================================');
        console.log('   WHATSAPP IS CONNECTED!');
        console.log(`   Phone: +${phoneNumber}`);
        console.log('======================================\n');

        await WhatsAppSession.findOneAndUpdate(
          { sessionId: SYSTEM_SESSION_ID },
          { 
            status: 'connected', 
            qrCode: null, 
            connectedAt: new Date(), 
            phoneNumber,
            lastActivity: new Date()
          },
          { upsert: true }
        );
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Also save creds to MongoDB
    sock.ev.on('creds.update', async () => {
      try {
        const credsData = JSON.parse(fs.readFileSync(path.join(authDir, 'creds.json'), 'utf-8'));
        await WhatsAppSession.findOneAndUpdate(
          { sessionId: SYSTEM_SESSION_ID },
          { creds: credsData, lastActivity: new Date() },
          { upsert: true }
        );
      } catch (e) {
        // ignore
      }
    });

  } catch (error) {
    console.error('Failed to initialize WhatsApp:', error);
    isConnecting = false;
  }
}

// Watch for send requests in MongoDB (message queue)
async function watchMessageQueue() {
  console.log('👀 Watching for message send requests...');
  
  // Check every 2 seconds for pending messages
  setInterval(async () => {
    if (!isReady || !sock) return;
    
    try {
      const WhatsAppMessage = mongoose.models.WhatsAppMessage || mongoose.model('WhatsAppMessage', new mongoose.Schema({
        to: String,
        message: String,
        status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
        error: String,
        sentAt: Date,
        createdAt: { type: Date, default: Date.now }
      }));

      const pendingMessages = await WhatsAppMessage.find({ status: 'pending' }).limit(10);
      
      for (const msg of pendingMessages) {
        try {
          let phoneNumber = msg.to.replace(/\D/g, '').replace(/^0+/, '');
          if (!phoneNumber.startsWith('970') && !phoneNumber.startsWith('972')) {
            phoneNumber = '970' + phoneNumber;
          }
          
          const jid = `${phoneNumber}@s.whatsapp.net`;
          
          // Try sending
          const isOnWA = await sock.onWhatsApp(jid);
          if (!isOnWA || !isOnWA[0]?.exists) {
            const altPhone = phoneNumber.replace(/^970/, '972');
            const altJid = `${altPhone}@s.whatsapp.net`;
            const isAltOnWA = await sock.onWhatsApp(altJid);
            if (isAltOnWA && isAltOnWA[0]?.exists) {
              await sock.sendMessage(altJid, { text: msg.message });
              msg.status = 'sent';
              msg.sentAt = new Date();
              await msg.save();
              console.log(`✅ Sent message to +${altPhone}`);
              continue;
            }
            msg.status = 'failed';
            msg.error = 'Number not on WhatsApp';
            await msg.save();
            continue;
          }
          
          await sock.sendMessage(jid, { text: msg.message });
          msg.status = 'sent';
          msg.sentAt = new Date();
          await msg.save();
          console.log(`✅ Sent message to +${phoneNumber}`);
        } catch (err) {
          msg.status = 'failed';
          msg.error = err.message;
          await msg.save();
          console.error(`❌ Failed to send to ${msg.to}:`, err.message);
        }
      }
    } catch (err) {
      // Silently ignore - collection might not exist yet
    }
  }, 2000);
}

// Watch for reconnect/disconnect commands from admin panel
async function watchCommands() {
  console.log('👀 Watching for admin commands...');
  
  setInterval(async () => {
    try {
      const session = await WhatsAppSession.findOne({ sessionId: SYSTEM_SESSION_ID });
      if (!session) return;
      
      // If admin requested force reconnect (status set to 'force_reconnect')
      if (session.status === 'force_reconnect') {
        console.log('🔄 Force reconnect requested from admin panel...');
        
        // Disconnect
        if (sock) {
          try { sock.ev.removeAllListeners(); } catch (e) {}
          try { sock.end(undefined); } catch (e) {}
          sock = null;
        }
        isReady = false;
        isConnecting = false;
        
        // Clear auth
        const authDir = path.join(__dirname, 'baileys_auth');
        if (fs.existsSync(authDir)) {
          const files = fs.readdirSync(authDir);
          for (const file of files) {
            try { fs.unlinkSync(path.join(authDir, file)); } catch (e) {}
          }
        }
        
        await WhatsAppSession.findOneAndUpdate(
          { sessionId: SYSTEM_SESSION_ID },
          { creds: null, keys: {}, status: 'connecting', qrCode: null },
          { upsert: true }
        );
        
        // Re-initialize
        await initializeWhatsApp();
      }
    } catch (err) {
      // ignore
    }
  }, 3000);
}

// Main
async function main() {
  console.log('🚀 WhatsApp Bridge Starting...');
  console.log('================================');
  
  await connectDB();
  await initializeWhatsApp();
  await watchMessageQueue();
  await watchCommands();
  
  console.log('\n📱 WhatsApp Bridge is running!');
  console.log('Keep this terminal open.');
  console.log('The admin panel will show WhatsApp status from MongoDB.\n');
}

main().catch(console.error);
