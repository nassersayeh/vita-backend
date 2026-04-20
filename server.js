// server.js
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const referralRoutes = require('./routes/referralRoutes');
// Existing routes
const authRoutes = require('./routes/auth');
const otpRoutes = require('./routes/otp');
const uploadRoutes = require('./routes/upload');
const profileRoutes = require('./routes/profile');
const doctorsRoutes = require('./routes/doctors');
const usersRoutes = require('./routes/users');
const userRoutes = require('./routes/user');
const pharmaciesRoutes = require('./routes/pharmacies');
const appointmentsRouter = require('./routes/appointments')
const patientRoutes = require('./routes/patientRoutes');
const orderRoutes = require('./routes/orderRoutes');
const userSettingsRoutes = require('./routes/Settings');
const settingsRoutes = require('./routes/settingsRoutes');
const friendRequestsRoutes = require('./routes/friendRequests');
const eventsRoutes = require('./routes/events');
const reflectOfferRoutes = require('./routes/reflectOfferRoutes');
const pointsRouter = require('./routes/pointsRouter');
const usersRouter = require('./routes/updateDeviceToken');
const financialRoutes = require('./routes/financialRoutes')
const notificationRoutes = require('./routes/notificationRoutes');
const AdminprofileRoutes = require('./routes/profileRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const supplierRoutes = require('./routes/supplierRoutes');

// New enhanced routes
const pointsNewRoutes = require('./routes/pointsNew');
const adminRoutes = require('./routes/admin');
const drugsRoutes = require('./routes/drugs');
const doctorWhatsappRoutes = require('./routes/doctorWhatsappRoutes');
const pharmacyWhatsappRoutes = require('./routes/pharmacyWhatsappRoutes');
const medicalTestsRoutes = require('./routes/medicalTests');
const labRequestsRoutes = require('./routes/labRequests');
const imageRequestsRoutes = require('./routes/imageRequests');
const prescriptionsEnhancedRoutes = require('./routes/prescriptionsEnhanced');
const pharmacyInventoryRoutes = require('./routes/pharmacyInventoryRoutes');
const pharmacyFinancialRoutes = require('./routes/pharmacyFinancial');
const pharmacyEmployeeRoutes = require('./routes/pharmacyEmployeeRoutes');
const pharmacySupplierRoutes = require('./routes/pharmacySupplierRoutes');
const medicalRecordRoutes = require('./routes/medicalRecord');
const pharmacyCustomerRoutes = require('./routes/pharmacyCustomerRoutes');
const insuranceCompanyRoutes = require('./routes/insuranceCompanyRoutes');
const claimRoutes = require('./routes/claimRoutes');
const doctorClaimRoutes = require('./routes/doctorClaimRoutes');
const oversightRoutes = require('./routes/oversightRoutes');
const aiRoutes = require('./routes/aiRoutes');
const insuranceClaimsRoutes = require('./routes/insuranceClaimsAPI');

// Firebase admin
const admin = require('firebase-admin');
// Support loading service account from env var (Vercel) or local file
let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    serviceAccount = require('./service-account.json.json');
  }
} catch (err) {
  console.warn('⚠️ Firebase service account not found. Push notifications will be disabled.');
  serviceAccount = null;
}

// WhatsApp Service (FREE - uses whatsapp-web.js)
let initializeWhatsApp, getWhatsAppStatus, forceReconnectWhatsApp, requestWhatsAppPairingCode;
try {
  ({ initializeWhatsApp, getWhatsAppStatus, forceReconnectWhatsApp, requestWhatsAppPairingCode } = require('./services/whatsappService'));
} catch (err) {
  console.warn('⚠️ WhatsApp service not available:', err.message);
  initializeWhatsApp = async () => {};
  getWhatsAppStatus = async () => ({ ready: false });
  forceReconnectWhatsApp = async () => {};
  requestWhatsAppPairingCode = async () => null;
}

// Reminder Service (Appointment reminders via WhatsApp + Push)
let startReminderScheduler;
try {
  ({ startReminderScheduler } = require('./services/reminderService'));
} catch (err) {
  console.warn('⚠️ Reminder service not available:', err.message);
  startReminderScheduler = () => {};
}

// Import models to register them with Mongoose
const Order = require('./models/Order');
const EPrescription = require('./models/EPrescription');
const User = require('./models/User');
const Product = require('./models/Product');
const Notification = require('./models/Notification');
const Points = require('./models/Points');

const app = express();

// CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-CSRF-Token', 'X-Api-Version'],
  credentials: true
}));

// Handle preflight OPTIONS requests
app.options('*', cors());

app.use(bodyParser.json());

// Connect to MongoDB
const providerRoutes = require('./routes/provider');
const medicationRoutes = require('./routes/medication');
const cartRoutes = require('./routes/cart');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://vitaUser:Pop%401990@127.0.0.1:27018/vita?authSource=admin';

// Connect to MongoDB immediately on startup
mongoose.connect(MONGODB_URI).then(() => {
  console.log('✅ MongoDB connected');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
});

// Middleware to ensure DB is connected before handling any request
app.use(async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGODB_URI);
    }
    next();
  } catch (err) {
    res.status(500).json({ message: 'Database connection error', error: err.message });
  }
});

// Mount existing routes
app.use('/api/auth', authRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/doctors', doctorsRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/orders', require('./routes/orders')); // Add new orders route
app.use('/uploads', express.static('uploads'));
app.use('/api/users', usersRoutes);
app.use('/api/user', userRoutes);
app.use('/api/pharmacies', pharmaciesRoutes);
app.use('/api/e-prescriptions', require('./routes/ePrescriptions'));
app.use('/api/products', require('./routes/products'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/appointment', require('./routes/appointment'));
app.use('/api/search', require('./routes/search'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/invoice', require('./routes/invoice'));
app.use('/api/doctors', require('./routes/doctor'));
app.use('/api/users', userSettingsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/pointss', pointsRouter);
app.use('/api/medicalrecords', require('./routes/medicalRecord'));
// Patient data endpoints
app.use('/api/patients', require('./routes/records'));
app.use('/api/patients', require('./routes/appointments'));
app.use('/api/patients', require('./routes/ePrescriptions'));
app.use('/api/patients', appointmentsRouter);
app.use('/api/doctors', patientRoutes);
app.use('/api/records', require('./routes/records'));
app.use('/api/friendRequests', friendRequestsRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/reflect-offers', reflectOfferRoutes);
app.use('/api', financialRoutes);
app.use('/api/notifications', usersRouter);
app.use('/api', notificationRoutes);
app.use('/api/profileRoutes', AdminprofileRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/suppliers', supplierRoutes);

// Mount new enhanced routes
app.use('/api/points-new', pointsNewRoutes);
app.use('/api/provider', providerRoutes);
app.use('/api/medication', medicationRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/drugs', drugsRoutes);
app.use('/api', doctorWhatsappRoutes);
app.use('/api', pharmacyWhatsappRoutes);
app.use('/api/medical-tests', medicalTestsRoutes);
app.use('/api/lab-requests', labRequestsRoutes);
app.use('/api/image-requests', imageRequestsRoutes);
app.use('/api/prescriptions-enhanced', prescriptionsEnhancedRoutes);
app.use('/api/pharmacy-inventory', pharmacyInventoryRoutes);
app.use('/api/pharmacy-financial', pharmacyFinancialRoutes);
app.use('/api/pharmacy-employees', pharmacyEmployeeRoutes);
app.use('/api/pharmacy-suppliers', pharmacySupplierRoutes);
app.use('/api/medical-records', medicalRecordRoutes);
app.use('/api/pharmacy', pharmacyCustomerRoutes);
app.use('/api/insurance-companies', insuranceCompanyRoutes);
app.use('/api/claims', claimRoutes);
app.use('/api/doctor-claims', doctorClaimRoutes);
app.use('/api/oversight', oversightRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/insurance-claims', insuranceClaimsRoutes);
app.use('/api/notifications', require('./routes/notifications'));

// Clinic routes
const clinicRoutes = require('./routes/clinicRoutes');
app.use('/api/clinic', clinicRoutes);

// New role routes
const nurseRoutes = require('./routes/nurseRoutes');
const accountantRoutes = require('./routes/accountantRoutes');
const labTechRoutes = require('./routes/labTechRoutes');
app.use('/api/nurse', nurseRoutes);
app.use('/api/accountant', accountantRoutes);
app.use('/api/labtech', labTechRoutes);

// Messaging routes (internal clinic chat)
const messagingRoutes = require('./routes/messagingRoutes');
app.use('/api/messaging', messagingRoutes);

// Initialize Firebase Admin
if (serviceAccount) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('✅ Firebase Admin initialized');
  } catch (err) {
    console.warn('⚠️ Firebase Admin initialization failed:', err.message);
  }
} else {
  console.warn('⚠️ Firebase Admin not initialized - no service account');
}

// WhatsApp status  (to check if QR scan is needed)
app.get('/api/whatsapp/status', async (req, res) => {
  try {
    const status = await getWhatsAppStatus();
    res.json({
      success: true,
      whatsapp: status
    });
  } catch (error) {
    console.error('WhatsApp status error:', error);
    res.status(500).json({
      success: false,
      whatsapp: { ready: false, initialized: false }
    });
  }
});

// Force reconnect WhatsApp (admin endpoint)
app.post('/api/whatsapp/reconnect', async (req, res) => {
  try {
    const result = await forceReconnectWhatsApp();
    const status = await getWhatsAppStatus();
    // Also include QR code directly from reconnect result
    if (result?.qrCode && !status.qrCode) {
      status.qrCode = result.qrCode;
      status.needsQrScan = true;
    }
    res.json({
      success: true,
      message: 'WhatsApp session cleared. Scan the QR code to connect.',
      qrCode: result?.qrCode || status.qrCode || null,
      whatsapp: status
    });
  } catch (error) {
    console.error('Force reconnect error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reconnect WhatsApp',
      error: error.message
    });
  }
});

// Request pairing code (admin endpoint)
app.post('/api/whatsapp/pair', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }
    const code = await requestWhatsAppPairingCode(phoneNumber);
    res.json({
      success: true,
      pairingCode: code,
      message: 'Pairing code generated. Enter this code in WhatsApp on your phone: Settings → Linked Devices → Link a Device → Link with phone number instead.'
    });
  } catch (error) {
    console.error('Pairing code error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate pairing code'
    });
  }
});

// Export app for Vercel serverless
module.exports = app;

// Only listen when running locally (not on Vercel)
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Initialize WhatsApp client for FREE messaging
    console.log('\n📱 Initializing WhatsApp for 2FA...');
    initializeWhatsApp();
    
    // Start appointment reminder scheduler
    console.log('\n⏰ Starting appointment reminder scheduler...');
    startReminderScheduler();
  });
}

// New API routes for enhanced functionality
const pharmacyAPIRoutes = require('./routes/pharmacyAPI');
const prescriptionRenewalAPIRoutes = require('./routes/prescriptionRenewalAPI');

// Mount new API routes
app.use('/api/pharmacy', pharmacyAPIRoutes);
app.use('/api/prescription-renewal', prescriptionRenewalAPIRoutes);
