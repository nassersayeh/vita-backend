const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Otp = require('../models/Otp');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { validatePasswordPolicy } = require('../utils/passwordPolicy');
const { send2FACode, sendWhatsAppMessage, isWhatsAppReady } = require('../services/whatsappService');
require('dotenv').config();

const RESET_REQUEST_MESSAGE = 'If an account matches that mobile number, a verification code will be sent.';
const DUMMY_PASSWORD_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const getPasswordPolicyMessage = (code) => ({
  PASSWORD_TOO_SHORT: 'Password must be at least 8 characters long.',
  PASSWORD_TOO_LONG: 'Password is too long.',
  PASSWORD_CONTAINS_NAME: 'Password must not contain the account holder name.',
}[code]);

const validatePassword = (password, fullName) => getPasswordPolicyMessage(validatePasswordPolicy(password, fullName));

const getResetCodeDigest = (userId, code) => {
  const secret = process.env.RESET_CODE_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('RESET_CODE_SECRET or JWT_SECRET must be configured.');
  return crypto.createHmac('sha256', secret).update(`${userId}:${code}`).digest('hex');
};

const getPhoneVerificationDigest = (userId, code) => {
  const secret = process.env.RESET_CODE_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('RESET_CODE_SECRET or JWT_SECRET must be configured.');
  return crypto.createHmac('sha256', secret).update(`phone:${userId}:${code}`).digest('hex');
};

const resetCodesMatch = (storedDigest, candidateDigest) => {
  if (!storedDigest || storedDigest.length !== candidateDigest.length) return false;
  return crypto.timingSafeEqual(Buffer.from(storedDigest, 'hex'), Buffer.from(candidateDigest, 'hex'));
};

const DEFAULT_DOCTOR_WORKPLACE_SCHEDULE = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  .map((day) => ({
    day,
    timeSlots: [{ start: '08:00', end: '16:00' }],
  }));

const createDefaultDoctorWorkplace = (fullName, address) => ({
  name: `${fullName}'s Clinic`,
  address,
  schedule: DEFAULT_DOCTOR_WORKPLACE_SCHEDULE,
  isActive: true,
});

const ID_FORMATS = {
  Palestine: { type: 'numeric', lengths: [9] },
  Jordan: { type: 'numeric', lengths: [10] },
  'Saudi Arabia': { type: 'numeric', lengths: [10] },
  Qatar: { type: 'numeric', lengths: [11] },
};

const validateIdNumber = (idNumber, country) => {
  const normalized = String(idNumber || '').trim().toUpperCase();
  const format = ID_FORMATS[country];
  if (!normalized) return { message: 'ID number is required.' };
  if (!format) return { message: 'Unsupported country.' };
  if (format.type === 'numeric' && !/^\d+$/.test(normalized)) return { message: 'ID number must contain digits only.' };
  if (format.type === 'alphanumeric' && !/^[A-Z0-9]+$/.test(normalized)) return { message: 'ID number must contain letters and digits only.' };
  if (!format.lengths.includes(normalized.length)) return { message: `ID number must be ${format.lengths.join(' or ')} characters long.` };
  return { value: normalized };
};

const requiresPatientProfileCompletion = (user) => user.role === 'User'
  && (!user.birthdate || !user.sex || !user.idNumber || !user.address);

exports.checkUsername = async (req, res) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    if (!username || username.length > 14 || !/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ available: false, message: 'Invalid username.' });
    }

    const exists = await User.exists({ username });
    return res.json({ available: !exists });
  } catch (error) {
    console.error('Username availability check failed:', error.message);
    return res.status(500).json({ message: 'Unable to check username right now.' });
  }
};

// Create email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail', // or your email service
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Example country mapping for mobile length validation if needed (not used now since we use email)
const countryMapping = {
  Palestine: { mobileLength: 13 },
  Qatar: { mobileLength: 11 },
};

const normalizeCountryName = (country = '') => String(country || '').trim().toLowerCase();

const getCountryDialingCodes = (country) => {
  const normalized = normalizeCountryName(country);
  if (normalized.includes('قطر') || normalized.includes('qatar')) return ['974'];
  if (normalized.includes('الأردن') || normalized.includes('اردن') || normalized.includes('jordan')) return ['962'];
  if (normalized.includes('السعود') || normalized.includes('saudi')) return ['966'];
  return ['970', '972'];
};

const normalizeLocalMobile = (mobile = '', country = '') => {
  let digits = String(mobile || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  const matchingCode = getCountryDialingCodes(country).find((code) => digits.startsWith(code));
  if (matchingCode) digits = digits.slice(matchingCode.length);

  digits = digits.replace(/^0+/, '');
  const normalizedCountry = normalizeCountryName(country);
  if ((normalizedCountry.includes('فلسطين') || normalizedCountry.includes('palestine') || normalizedCountry.includes('السعود') || normalizedCountry.includes('saudi')) && digits.startsWith('5')) {
    return `0${digits}`;
  }
  if ((normalizedCountry.includes('الأردن') || normalizedCountry.includes('اردن') || normalizedCountry.includes('jordan')) && digits.startsWith('7')) {
    return `0${digits}`;
  }

  return digits;
};

const getMobileLookupCandidates = (mobile = '', country = '') => {
  const rawDigits = String(mobile || '').replace(/\D/g, '');
  const localMobile = normalizeLocalMobile(mobile, country);
  const localWithoutZero = localMobile.replace(/^0+/, '');
  const countryVariants = getCountryDialingCodes(country).map((code) => `${code}${localWithoutZero}`);

  return Array.from(new Set([
    mobile,
    rawDigits,
    localMobile,
    localWithoutZero,
    ...countryVariants,
  ].filter(Boolean)));
};

const getLoginMobileLookupCandidates = (mobile = '') => {
  const rawDigits = String(mobile || '').replace(/\D/g, '');
  const withoutInternationalPrefix = rawDigits.startsWith('00') ? rawDigits.slice(2) : rawDigits;
  const allCodes = ['970', '972', '974', '966', '962'];
  const stripped = allCodes.reduce((value, code) => (
    value.startsWith(code) ? value.slice(code.length) : value
  ), withoutInternationalPrefix).replace(/^0+/, '');

  return Array.from(new Set([
    mobile,
    rawDigits,
    withoutInternationalPrefix,
    stripped,
    stripped ? `0${stripped}` : '',
    ...allCodes.map((code) => `${code}${stripped}`),
  ].filter(Boolean)));
};

const formatWhatsAppDisplayName = (fullName = '', role = 'User', language = 'ar') => {
  const name = String(fullName || '').trim();
  if (!name) return '';

  const roleTitles = language === 'ar'
    ? {
      Doctor: 'د.',
      Pharmacy: 'صيدلية',
      Lab: 'مختبر',
      Clinic: 'عيادة',
      Hospital: 'مستشفى',
      Institution: 'مركز',
    }
    : {
      Doctor: 'Dr.',
      Pharmacy: 'Pharmacy',
      Lab: 'Lab',
      Clinic: 'Clinic',
      Hospital: 'Hospital',
      Institution: 'Medical Center',
    };

  const title = roleTitles[role];
  return title ? `${title} ${name}` : name;
};

exports.signup = async (req, res) => {
  try {
    const { profileImage, fullName, username, birthdate, mobile, password, country, city, idNumber, address, sex, role, email, termsAccepted, registrationChannel } = req.body;
    const stringInputs = { fullName, username, mobile, password, country, city, idNumber, address, sex, role, email };
    if (Object.values(stringInputs).some((value) => value !== undefined && typeof value !== 'string')) {
      return res.status(400).json({ message: 'Invalid registration data.' });
    }
    if ([fullName, username, mobile, country, city, idNumber, address, email].some((value) => value && value.length > 200)) {
      return res.status(400).json({ message: 'Invalid registration data.' });
    }
    const normalizedMobile = normalizeLocalMobile(mobile, country);
    
    // Normalize email - treat empty string as undefined
    const normalizedEmail = email && email.trim() ? email.trim() : undefined;
    // Normalize username - treat empty string as undefined
    const normalizedUsername = username && username.trim() ? username.trim() : undefined;
    
    // Terms acceptance is optional for backwards compatibility with older mobile builds.
    
    // Basic validations
    const isDeferredMobilePatient = registrationChannel === 'mobile' && role === 'User';
    if (!fullName || !mobile || !country || !city || (!isDeferredMobilePatient && !idNumber) || !role) {
      return res.status(400).json({ message: 'Please fill all required fields.' });
    }
    
    // Only the simplified mobile patient flow may defer the address.
    if (!isDeferredMobilePatient && !address) {
      return res.status(400).json({ message: 'Address is required.' });
    }

    
    // Email is optional for all roles
    
    // Check if mobile number already exists
    const existingUser = await User.findOne({ mobileNumber: { $in: getMobileLookupCandidates(mobile, country) } });
    if (existingUser) return res.status(400).json({ message: 'mobileNumber already exists.' });
    
    // Check if idNumber already exists
    if (idNumber) {
      const idValidation = validateIdNumber(idNumber, country);
      if (idValidation.message) return res.status(400).json({ message: idValidation.message });
      const existingId = await User.findOne({ idNumber: idValidation.value });
      if (existingId) return res.status(400).json({ message: 'idNumber already exists.' });
    }
    
    // Check if username already exists (if provided and not empty)
    if (normalizedUsername) {
      const existingUsername = await User.findOne({ username: normalizedUsername });
      if (existingUsername) return res.status(400).json({ message: 'username already exists.' });
    }
    
    // Check if email already exists (if provided and not empty)
    if (normalizedEmail) {
      const existingEmail = await User.findOne({ email: normalizedEmail });
      if (existingEmail) return res.status(400).json({ message: 'email already exists.' });
    }
    
    const passwordError = validatePassword(password, fullName);
    if (passwordError) return res.status(400).json({ message: passwordError });
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Generate verification code
    const verificationCode = crypto.randomInt(100000, 1000000).toString();
    const verificationCodeExpiration = Date.now() + 10 * 60 * 1000; // 10 minutes
    
    const newUser = new User({
      fullName,
      username: normalizedUsername,
      mobileNumber: normalizedMobile,
      email: normalizedEmail,
      password: hashedPassword,
      country,
      city,
      idNumber: idNumber ? String(idNumber).trim().toUpperCase() : undefined,
      birthdate,
      address,
      sex: ['Pharmacy', 'Lab', 'Clinic'].includes(role) ? undefined : sex,
      role,
      profileImage,
      isPhoneVerified: false, // Not verified yet
      phoneVerificationCodeExpiration: verificationCodeExpiration,
      // Terms and Conditions
      termsAccepted: Boolean(termsAccepted),
      termsAcceptedAt: termsAccepted ? new Date() : undefined,
      termsVersion: '1.0',
      // Add default workplace for doctors
      workplaces: role === 'Doctor' ? [createDefaultDoctorWorkplace(fullName, address)] : undefined,
    });
    newUser.phoneVerificationCode = getPhoneVerificationDigest(newUser._id, verificationCode);
    await newUser.save();
    
    // For professional roles (Pharmacy, Doctor, Lab, Clinic), skip verification - auto-login
    if (['Pharmacy', 'Doctor', 'Lab', 'Clinic'].includes(role)) {
      newUser.isPhoneVerified = true;
      newUser.phoneVerificationCode = undefined;
      newUser.phoneVerificationCodeExpiration = undefined;
      await newUser.save({ validateBeforeSave: false });

      // Send welcome WhatsApp message
      try {
        if (await isWhatsAppReady()) {
          const displayNameAr = formatWhatsAppDisplayName(fullName, role, 'ar');
          const displayNameEn = formatWhatsAppDisplayName(fullName, role, 'en');
          const welcomeMsg = role === 'Pharmacy'
            ? (
              `مرحباً ${displayNameAr} 👋\n` +
              `أهلاً وسهلاً بك في نظام *فيتا الصحي* 🏥\n\n` +
              `تم تسجيل صيدليتك بنجاح في فيتا، نظام إدارة القطاع الصحي الذي يربط الأطباء والصيدليات والمرضى في شبكة واحدة.\n` +
              `تنضم الآن إلى شبكة تضم أكثر من ١٠٠٠ طبيب، و١٠٠ صيدلية، و١٠ آلاف مستخدم.\n` +
              `سيتم إرسال بيانات تسجيل الدخول قريباً.\n\n` +
              `لأي استفسار أو دعم فني، يمكنك التواصل معنا مباشرةً على هذا الرقم وسيتولى فريقنا مساعدتك. 💬\n\n` +
              `---\n` +
              `Hello ${displayNameEn} 👋\n` +
              `Welcome to *Vita Health System* 🏥\n\n` +
              `Your pharmacy has been registered successfully on Vita, a healthcare management system connecting doctors, pharmacies, and patients in one network.\n` +
              `You are now joining a network of more than 1,000 doctors, 100 pharmacies, and 10,000 users.\n` +
              `Your login details will be sent soon.\n\n` +
              `For any inquiries or technical support, feel free to message us on this number and our team will assist you. 💬`
            )
            : (
              `مرحباً ${displayNameAr} 👋\n` +
              `أهلاً وسهلاً بك في نظام *فيتا الصحي* 🏥\n\n` +
              `تم تسجيلك بنجاح في نظام فيتا لاستقبال المواعيد وإدارة العيادات. أوسع شبكة طبية والتي تضم أكثر من ١٠ آلاف مريض مسجل.\n` +
              `سيتم إرسال بيانات تسجيل الدخول قريباً.\n\n` +
              `لأي استفسار أو دعم فني، يمكنك التواصل معنا مباشرةً على هذا الرقم وسيتولى فريقنا مساعدتك. 💬\n\n` +
              `---\n` +
              `Hello ${displayNameEn} 👋\n` +
              `Welcome to *Vita Health System* 🏥\n\n` +
              `You have been registered successfully on Vita for receiving appointments and managing clinics. Vita is the widest medical network, with more than 10,000 registered patients.\n` +
              `Your login details will be sent soon.\n\n` +
              `For any inquiries or technical support, feel free to message us on this number and our team will assist you. 💬`
            );

          for (const phoneNumber of getCountryDialingCodes(country).map((code) => `${code}${normalizedMobile.replace(/^0+/, '')}`)) {
            try { await sendWhatsAppMessage(phoneNumber, welcomeMsg); } catch {}
          }
        }
      } catch (waErr) {
        console.error('Welcome WhatsApp message failed:', waErr.message);
      }
      
      // Auto-generate token so pharmacy can login immediately
      const token = jwt.sign(
        { userId: newUser._id, role: newUser.role },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      return res.status(201).json({ 
        success: true, 
        message: 'Account created. Waiting for admin approval.',
        requiresVerification: false,
        autoLogin: true,
        user: {
          id: newUser._id,
          _id: newUser._id,
          fullName: newUser.fullName,
          mobile: newUser.mobileNumber,
          mobileNumber: newUser.mobileNumber,
          email: newUser.email,
          role: newUser.role,
          country: newUser.country,
          city: newUser.city,
          address: newUser.address,
          idNumber: newUser.idNumber,
          birthdate: newUser.birthdate,
          sex: newUser.sex,
          profileImage: newUser.profileImage,
          points: 0,
          language: newUser.language || 'en',
          activationStatus: newUser.activationStatus,
          termsAccepted: newUser.termsAccepted,
          termsAcceptedAt: newUser.termsAcceptedAt,
          termsVersion: newUser.termsVersion,
          subscriptionPlanKey: newUser.subscriptionPlanKey,
          subscriptionPlanName: newUser.subscriptionPlanName,
          subscriptionMonthlyPrice: newUser.subscriptionMonthlyPrice,
          subscriptionYearlyPrice: newUser.subscriptionYearlyPrice,
          subscriptionBillingCycle: newUser.subscriptionBillingCycle,
          subscriptionSelectedPrice: newUser.subscriptionSelectedPrice,
          subscriptionStatus: newUser.subscriptionStatus,
          paymentMethod: newUser.paymentMethod,
          isPaid: newUser.isPaid,
        },
        token,
      });
    }
    
    // Send verification code via multiple channels
    let sentVia = [];
    
    // WhatsApp availability must never make signup fail after the account was
    // created. The bridge can briefly throw while reconnecting.
    let whatsappReady = false;
    try { whatsappReady = await isWhatsAppReady(); } catch (statusError) {
      console.warn('WhatsApp readiness check failed during signup:', statusError.message);
    }
    if (whatsappReady) {
      try {
        const whatsappResult = await send2FACode(normalizedMobile, verificationCode, 'en', country);
        sentVia.push('whatsapp');
        console.log(`Verification code sent via WhatsApp to: ${whatsappResult.sentTo.join(', ')}`);
      } catch (whatsappError) {
        console.error('WhatsApp failed:', whatsappError.message);
      }
    } else {
      console.log('WhatsApp not ready, skipping WhatsApp verification');
    }
    
    // Always try email if provided
    if (normalizedEmail) {
      try {
        const mailOptions = {
          from: `"Vita" <${process.env.EMAIL_USER}>`,
          to: normalizedEmail,
          subject: '🔐 Verify Your Vita Account',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
              <h1 style="color: #32ae98; text-align: center;">Welcome to Vita!</h1>
              <p style="text-align: center;">Your verification code is:</p>
              <div style="background: #32ae98; color: white; padding: 20px; text-align: center; font-size: 32px; letter-spacing: 8px; border-radius: 10px; margin: 20px 0;">
                ${verificationCode}
              </div>
              <p style="color: #666; text-align: center; font-size: 14px;">This code expires in 10 minutes.</p>
            </div>
          `,
          text: `Your Vita verification code is: ${verificationCode}. This code expires in 10 minutes.`
        };
        await transporter.sendMail(mailOptions);
        sentVia.push('email');
        console.log(`Verification code sent via email to ${normalizedEmail}`);
      } catch (emailError) {
        console.error('Email failed:', emailError.message);
      }
    }
    
    // If no method succeeded, still allow registration but warn
    if (sentVia.length === 0) {
      console.warn('⚠️ No verification channel available. User created without verification code delivery.');
      // Don't delete the user - allow them to request a resend later
      return res.status(201).json({ 
        success: true, 
        message: 'Account created. Verification code could not be sent right now. You can request a new code after logging in.',
        requiresVerification: true,
        userId: newUser._id,
        sentVia: [],
        ...(process.env.NODE_ENV === 'development' && { devCode: verificationCode }),
      });
    }
    
    res.status(201).json({ 
      success: true, 
      message: 'Account created. Please verify your phone number.',
      requiresVerification: true,
      userId: newUser._id,
      sentVia: sentVia,
      ...(process.env.NODE_ENV === 'development' && { devCode: verificationCode }),
      // For development only - remove in production
      ...(process.env.NODE_ENV === 'development' && { devCode: verificationCode })
    });
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyValue)[0];
      return res.status(400).json({ message: `${field} already exists.` });
    }
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message).join(', ');
      return res.status(400).json({ message: `Validation error: ${messages}` });
    }
    res.status(500).json({ message: 'Server error during signup.' });
  }
};

exports.login = async (req, res) => {
  try {
    const { mobile, password } = req.body;
    if (typeof mobile !== 'string' || !mobile || mobile.length > 40 || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ message: 'Invalid mobile number or password.' });
    }
    const user = await User.findOne({ mobileNumber: { $in: getLoginMobileLookupCandidates(mobile) } });
    
    // If not found in Users, check InsuranceCompany and OversightAccount
    if (!user) {
      const InsuranceCompany = require('../models/InsuranceCompany');
      const OversightAccount = require('../models/OversightAccount');
      
      // Check insurance companies
      const insuranceCompany = await InsuranceCompany.findOne({ phone: mobile, status: 'active' });
      if (insuranceCompany) {
        const isMatch = await bcrypt.compare(password, insuranceCompany.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid mobile number or password.' });
        
        const token = jwt.sign(
          { companyId: insuranceCompany._id, role: 'insurance_company' },
          process.env.JWT_SECRET,
          { expiresIn: '7d' }
        );
        
        return res.json({
          message: 'Login successful',
          user: {
            id: insuranceCompany._id,
            _id: insuranceCompany._id,
            fullName: insuranceCompany.name,
            nameAr: insuranceCompany.nameAr,
            mobile: insuranceCompany.phone,
            mobileNumber: insuranceCompany.phone,
            role: 'insurance_company',
            profileImage: null,
            points: 0,
          },
          token,
          redirectTo: '/insurance-claims',
        });
      }
      
      // Check oversight/union accounts
      const oversightAccount = await OversightAccount.findOne({ phone: mobile });
      if (oversightAccount) {
        const isMatch = await bcrypt.compare(password, oversightAccount.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid mobile number or password.' });
        
        const token = jwt.sign(
          { accountId: oversightAccount._id, role: 'oversight' },
          process.env.JWT_SECRET,
          { expiresIn: '7d' }
        );
        
        return res.json({
          message: 'Login successful',
          user: {
            id: oversightAccount._id,
            _id: oversightAccount._id,
            fullName: oversightAccount.name,
            nameAr: oversightAccount.nameAr,
            mobile: oversightAccount.phone,
            mobileNumber: oversightAccount.phone,
            role: 'oversight',
            type: oversightAccount.type,
            profileImage: null,
            points: 0,
          },
          token,
          redirectTo: '/pharmacist-union',
        });
      }
      
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      return res.status(400).json({ message: 'Invalid mobile number or password.' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid mobile number or password.' });
    
    // Check if phone is verified
    if (user.isPhoneVerified === false) {
      // Generate new verification code
      const verificationCode = crypto.randomInt(100000, 1000000).toString();
      const verificationCodeExpiration = Date.now() + 10 * 60 * 1000;
      
      user.phoneVerificationCode = getPhoneVerificationDigest(user._id, verificationCode);
      user.phoneVerificationCodeExpiration = verificationCodeExpiration;
      await user.save({ validateBeforeSave: false });
      
      // Send verification code via multiple channels
      let sentVia = [];
      
      // Always try WhatsApp if ready
      if (await isWhatsAppReady()) {
        try {
          const whatsappResult = await send2FACode(user.mobileNumber, verificationCode, 'en', user.country);
          sentVia.push('whatsapp');
          console.log(`Verification code sent via WhatsApp to: ${whatsappResult.sentTo.join(', ')}`);
        } catch (whatsappError) {
          console.error('WhatsApp failed:', whatsappError.message);
        }
      }
      
      // Always try email if available
      if (user.email) {
        try {
          const mailOptions = {
            from: `"Vita" <${process.env.EMAIL_USER}>`,
            to: user.email,
            subject: '🔐 Verify Your Vita Account',
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
                <h1 style="color: #32ae98; text-align: center;">Verify Your Vita Account</h1>
                <p style="text-align: center;">Your verification code is:</p>
                <div style="background: #32ae98; color: white; padding: 20px; text-align: center; font-size: 32px; letter-spacing: 8px; border-radius: 10px; margin: 20px 0;">
                  ${verificationCode}
                </div>
                <p style="color: #666; text-align: center; font-size: 14px;">This code expires in 10 minutes.</p>
              </div>
            `,
            text: `Your Vita verification code is: ${verificationCode}. This code expires in 10 minutes.`
          };
          await transporter.sendMail(mailOptions);
          sentVia.push('email');
          console.log(`Verification code sent via email to ${user.email}`);
        } catch (emailError) {
          console.error('Email failed:', emailError.message);
        }
      }
      
      return res.status(403).json({ 
        message: 'Phone number not verified.',
        requiresVerification: true,
        userId: user._id,
        sentVia: sentVia,
        ...(process.env.NODE_ENV === 'development' && { devCode: verificationCode })
      });
    }
    
    // Check for daily login reward
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Set to start of day
    
    let dailyPointsEarned = 0;
    let updatedUser = user;
    
    // Check if user hasn't logged in today
    if (!user.lastLoginDate || new Date(user.lastLoginDate) < today) {
      // Award daily login points (1 point)
      const currentPoints = user.points || 0;
      dailyPointsEarned = 1;
      
      updatedUser = await User.findByIdAndUpdate(
        user._id,
        {
          $set: {
            points: currentPoints + dailyPointsEarned,
            lastLoginDate: new Date()
          }
        },
        { new: true }
      );
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({ 
      message: 'Login successful', 
      user: {
        id: updatedUser._id,
        _id: updatedUser._id,
        fullName: updatedUser.fullName,
        mobile: updatedUser.mobileNumber,
        mobileNumber: updatedUser.mobileNumber,
        email: updatedUser.email,
        role: updatedUser.role,
        country: updatedUser.country,
        city: updatedUser.city,
        address: updatedUser.address,
        idNumber: updatedUser.idNumber,
        birthdate: updatedUser.birthdate,
        sex: updatedUser.sex,
        requiresProfileCompletion: requiresPatientProfileCompletion(updatedUser),
        height: updatedUser.height,
        weight: updatedUser.weight,
        bloodType: updatedUser.bloodType,
        profileCompletionPromptDismissed: updatedUser.profileCompletionPromptDismissed,
        profileImage: updatedUser.profileImage,
        points: updatedUser.points || 0,
        language: updatedUser.language || 'en',
        specialty: updatedUser.specialty || '',
        patientOrderingEnabled: updatedUser.patientOrderingEnabled,
        managedByClinic: updatedUser.managedByClinic || false,
        clinicId: updatedUser.clinicId || null,
        activationStatus: updatedUser.activationStatus,
        termsAccepted: updatedUser.termsAccepted,
        termsAcceptedAt: updatedUser.termsAcceptedAt,
        termsVersion: updatedUser.termsVersion,
        subscriptionPlanKey: updatedUser.subscriptionPlanKey,
        subscriptionPlanName: updatedUser.subscriptionPlanName,
        subscriptionMonthlyPrice: updatedUser.subscriptionMonthlyPrice,
        subscriptionYearlyPrice: updatedUser.subscriptionYearlyPrice,
        subscriptionBillingCycle: updatedUser.subscriptionBillingCycle,
        subscriptionSelectedPrice: updatedUser.subscriptionSelectedPrice,
        subscriptionStatus: updatedUser.subscriptionStatus,
        subscriptionStartDate: updatedUser.subscriptionStartDate,
        subscriptionEndDate: updatedUser.subscriptionEndDate,
        trialStartDate: updatedUser.trialStartDate,
        trialEndDate: updatedUser.trialEndDate,
        paymentMethod: updatedUser.paymentMethod,
        isPaid: updatedUser.isPaid,
      },
      token,
      dailyPointsEarned
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login.' });
  }
};

exports.completeMobileProfile = async (req, res) => {
  try {
    if (req.user.role !== 'User') return res.status(403).json({ message: 'Patient profile only.' });

    const { birthdate, sex, idNumber, address } = req.body || {};
    const cleanAddress = typeof address === 'string' ? address.trim() : '';
    if (!cleanAddress || cleanAddress.length > 200) return res.status(400).json({ field: 'address', message: 'A valid address is required.' });
    if (!['Male', 'Female'].includes(sex)) return res.status(400).json({ field: 'sex', message: 'A valid gender is required.' });

    const parsedBirthdate = new Date(birthdate);
    const today = new Date();
    if (!birthdate || Number.isNaN(parsedBirthdate.getTime()) || parsedBirthdate > today) {
      return res.status(400).json({ field: 'birthdate', message: 'A valid date of birth is required.' });
    }

    const idValidation = validateIdNumber(idNumber, req.user.country);
    if (idValidation.message) return res.status(400).json({ field: 'idNumber', message: idValidation.message });
    const duplicate = await User.exists({ idNumber: idValidation.value, _id: { $ne: req.user._id } });
    if (duplicate) return res.status(409).json({ field: 'idNumber', message: 'idNumber already exists.' });

    req.user.birthdate = parsedBirthdate;
    req.user.sex = sex;
    req.user.idNumber = idValidation.value;
    req.user.address = cleanAddress;
    await req.user.save();

    const user = req.user.toObject();
    delete user.password;
    delete user.phoneVerificationCode;
    delete user.resetCode;
    user.requiresProfileCompletion = false;
    return res.json({ message: 'Profile completed successfully.', user });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ field: 'idNumber', message: 'idNumber already exists.' });
    console.error('Mobile profile completion error:', error);
    return res.status(500).json({ message: 'Server error while completing profile.' });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const mobile = req.body.mobile || req.body.mobileNumber || req.body.phone;
    if (typeof mobile !== 'string' || !mobile || mobile.length > 40) return res.status(400).json({ message: 'Mobile number is required.' });

    // Check delivery availability before looking up the account. This keeps
    // account existence private while preventing a false "code sent" result.
    if (!(await isWhatsAppReady())) {
      console.warn('Password reset delivery unavailable: WhatsApp is not connected.');
      return res.status(503).json({ message: 'Password reset delivery is temporarily unavailable.' });
    }

    const user = await User.findOne({ mobileNumber: { $in: getLoginMobileLookupCandidates(mobile) } });
    if (!user) {
      await bcrypt.compare('not-a-real-password', DUMMY_PASSWORD_HASH);
      return res.json({ message: RESET_REQUEST_MESSAGE });
    }
    if (!user.mobileNumber) {
      return res.json({ message: RESET_REQUEST_MESSAGE });
    }
    const resetCode = crypto.randomInt(100000, 1000000).toString();
    const resetCodeExpiration = Date.now() + 10 * 60 * 1000;
    user.resetCode = getResetCodeDigest(user._id, resetCode);
    user.resetCodeExpiration = resetCodeExpiration;
    user.resetCodeAttempts = 0;
    // Save without validating required fields
    await user.save({ validateBeforeSave: false });

    await send2FACode(user.mobileNumber, resetCode, 'en', user.country);
    res.json({
      message: RESET_REQUEST_MESSAGE,
      sentVia: ['whatsapp']
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: 'Unable to process the request right now.' });
  }
};


exports.verifyCode = async (req, res) => {
  try {
    const mobile = req.body.mobile || req.body.mobileNumber || req.body.phone;
    const { code, newPassword } = req.body;
    if (typeof mobile !== 'string' || mobile.length > 40 || !/^\d{6}$/.test(String(code || ''))) {
      return res.status(400).json({ message: 'Mobile number and a valid verification code are required.' });
    }

    const user = await User.findOne({ mobileNumber: { $in: getLoginMobileLookupCandidates(mobile) } })
      .select('+resetCodeAttempts');
    if (!user || !user.resetCode || !user.resetCodeExpiration) {
      return res.status(400).json({ message: 'Invalid or expired code.' });
    }

    if (Date.now() > user.resetCodeExpiration || (user.resetCodeAttempts || 0) >= 5) {
      user.resetCode = undefined;
      user.resetCodeExpiration = undefined;
      user.resetCodeAttempts = 0;
      await user.save({ validateBeforeSave: false });
      return res.status(400).json({ message: 'Invalid or expired code.' });
    }

    const candidateDigest = getResetCodeDigest(user._id, String(code));
    if (!resetCodesMatch(user.resetCode, candidateDigest)) {
      user.resetCodeAttempts = (user.resetCodeAttempts || 0) + 1;
      await user.save({ validateBeforeSave: false });
      return res.status(400).json({ message: 'Invalid or expired code.' });
    }

    // The web flow validates the code on its own step before asking for a new
    // password. Keep the same code alive for the final reset request.
    if (!newPassword) {
      return res.json({ message: 'Verification code is valid.', requiresNewPassword: true });
    }

    const passwordError = validatePassword(newPassword, user.fullName);
    if (passwordError) return res.status(400).json({ message: passwordError });

    if (await bcrypt.compare(newPassword, user.password)) {
      return res.status(400).json({ message: 'This password was used before. Choose a different password.' });
    }

    // Generate salt and hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    user.password = hashedPassword;
    user.passwordChangedAt = new Date();
    user.resetCode = undefined;
    user.resetCodeExpiration = undefined;
    user.resetCodeAttempts = 0;
    // Save without running all validations
    await user.save({ validateBeforeSave: false });

    res.json({ message: "Password reset successfully." });
  } catch (error) {
    console.error("Verify code error:", error);
    res.status(500).json({ message: "Server error." });
  }
};

// Verify phone number after registration
exports.verifyPhone = async (req, res) => {
  try {
    const { userId, code } = req.body;
    
    if (!userId || !code) {
      return res.status(400).json({ message: 'User ID and verification code are required.' });
    }
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }
    
    if (user.isPhoneVerified) {
      return res.status(400).json({ message: 'Phone number is already verified.' });
    }
    
    if (!user.phoneVerificationCode || !user.phoneVerificationCodeExpiration) {
      return res.status(400).json({ message: 'No verification code found. Please request a new one.' });
    }
    
    if (Date.now() > user.phoneVerificationCodeExpiration) {
      return res.status(400).json({ message: 'Verification code has expired. Please request a new one.' });
    }
    
    const candidateDigest = getPhoneVerificationDigest(user._id, String(code));
    const isLegacyPlaintextCode = user.phoneVerificationCode === String(code);
    if (!isLegacyPlaintextCode && !resetCodesMatch(user.phoneVerificationCode, candidateDigest)) {
      return res.status(400).json({ message: 'Invalid verification code.' });
    }
    
    // Verify the phone
    user.isPhoneVerified = true;
    user.phoneVerificationCode = undefined;
    user.phoneVerificationCodeExpiration = undefined;
    await user.save({ validateBeforeSave: false });
    
    res.json({ 
      success: true, 
      message: 'Phone number verified successfully. You can now log in.' 
    });
  } catch (error) {
    console.error('Verify phone error:', error);
    res.status(500).json({ message: 'Server error during verification.' });
  }
};

// Resend phone verification code
exports.resendVerificationCode = async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required.' });
    }
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }
    
    if (user.isPhoneVerified) {
      return res.status(400).json({ message: 'Phone number is already verified.' });
    }
    
    // Generate a new code, but keep the current valid code recoverable until
    // delivery succeeds. A failed resend must not invalidate the code the user
    // may already have received.
    const previousCode = user.phoneVerificationCode;
    const previousExpiration = user.phoneVerificationCodeExpiration;
    const verificationCode = crypto.randomInt(100000, 1000000).toString();
    const verificationCodeExpiration = Date.now() + 10 * 60 * 1000; // 10 minutes
    
    user.phoneVerificationCode = getPhoneVerificationDigest(user._id, verificationCode);
    user.phoneVerificationCodeExpiration = verificationCodeExpiration;
    await user.save({ validateBeforeSave: false });
    
    // Send verification code via multiple channels
    let sentVia = [];
    
    let whatsappReady = false;
    try { whatsappReady = await isWhatsAppReady(); } catch (statusError) {
      console.warn('WhatsApp readiness check failed during resend:', statusError.message);
    }
    if (whatsappReady) {
      try {
        const whatsappResult = await send2FACode(user.mobileNumber, verificationCode, 'en', user.country);
        sentVia.push('whatsapp');
        console.log(`Verification code resent via WhatsApp to: ${whatsappResult.sentTo.join(', ')}`);
      } catch (whatsappError) {
        console.error('WhatsApp failed:', whatsappError.message);
      }
    }
    
    // Always try email if available
    if (user.email) {
      try {
        const mailOptions = {
          from: `"Vita" <${process.env.EMAIL_USER}>`,
          to: user.email,
          subject: '🔐 Verify Your Vita Account',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
              <h1 style="color: #32ae98; text-align: center;">Vita Verification</h1>
              <p style="text-align: center;">Your new verification code is:</p>
              <div style="background: #32ae98; color: white; padding: 20px; text-align: center; font-size: 32px; letter-spacing: 8px; border-radius: 10px; margin: 20px 0;">
                ${verificationCode}
              </div>
              <p style="color: #666; text-align: center; font-size: 14px;">This code expires in 10 minutes.</p>
            </div>
          `,
          text: `Your Vita verification code is: ${verificationCode}. This code expires in 10 minutes.`
        };
        await transporter.sendMail(mailOptions);
        sentVia.push('email');
        console.log(`Verification code resent via email to ${user.email}`);
      } catch (emailError) {
        console.error('Email failed:', emailError.message);
      }
    }
    
    if (sentVia.length === 0) {
      if (process.env.NODE_ENV === 'development') {
        return res.json({ success: true, message: 'Development verification code generated.', sentVia: ['development'], devCode: verificationCode });
      }
      user.phoneVerificationCode = previousCode;
      user.phoneVerificationCodeExpiration = previousExpiration;
      await user.save({ validateBeforeSave: false });
      return res.status(503).json({ message: 'Verification delivery is temporarily unavailable. Your previous code is still valid.' });
    }
    
    res.json({ 
      success: true, 
      message: `Verification code sent via ${sentVia.join(' and ')}.`,
      sentVia: sentVia,
      ...(process.env.NODE_ENV === 'development' && { devCode: verificationCode })
    });
  } catch (error) {
    console.error('Resend verification code error:', error);
    res.status(500).json({ message: 'Server error.' });
  }
};
