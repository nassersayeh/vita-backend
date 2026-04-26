const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Otp = require('../models/Otp');
const nodemailer = require('nodemailer');
const { send2FACode, sendWhatsAppMessage, isWhatsAppReady } = require('../services/whatsappService');
require('dotenv').config();

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

exports.signup = async (req, res) => {
  try {
    const { profileImage, fullName, username, birthdate, mobile, password, country, city, idNumber, address, sex, role, email } = req.body;
    
    // Normalize email - treat empty string as undefined
    const normalizedEmail = email && email.trim() ? email.trim() : undefined;
    // Normalize username - treat empty string as undefined
    const normalizedUsername = username && username.trim() ? username.trim() : undefined;
    
    // Basic validations
    if (!fullName || !mobile || !password || !country || !city || !idNumber || !role) {
      return res.status(400).json({ message: 'Please fill all required fields.' });
    }
    
    // Address required only for patients
    if (role === 'User' && !address) {
      return res.status(400).json({ message: 'Address is required.' });
    }
    
    // Email is optional for all roles
    
    // Check if mobile number already exists
    const existingUser = await User.findOne({ mobileNumber: mobile });
    if (existingUser) return res.status(400).json({ message: 'mobileNumber already exists.' });
    
    // Check if idNumber already exists
    const existingId = await User.findOne({ idNumber });
    if (existingId) return res.status(400).json({ message: 'idNumber already exists.' });
    
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
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Generate verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationCodeExpiration = Date.now() + 10 * 60 * 1000; // 10 minutes
    
    const newUser = new User({
      fullName,
      username: normalizedUsername,
      mobileNumber: mobile,
      email: normalizedEmail,
      password: hashedPassword,
      country,
      city,
      idNumber,
      birthdate,
      address,
      sex: ['Pharmacy', 'Lab', 'Clinic'].includes(role) ? undefined : sex,
      role,
      profileImage,
      isPhoneVerified: false, // Not verified yet
      phoneVerificationCode: verificationCode,
      phoneVerificationCodeExpiration: verificationCodeExpiration,
      // Add default workplace for doctors
      workplaces: role === 'Doctor' ? [{
        name: `${fullName}'s Clinic`,
        address: address,
        isActive: true
      }] : undefined,
      // Initialize subscription for new pharmacies
      isPaid: role === 'Pharmacy' ? false : undefined,
      subscriptionType: role === 'Pharmacy' ? 'free' : undefined,
      subscriptionStatus: role === 'Pharmacy' ? 'inactive' : undefined,
    });
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
          const welcomeMsg =
            `مرحباً ${fullName} 👋\n` +
            `أهلاً وسهلاً بك في نظام *فيتا الصحي* 🏥\n\n` +
            `تم استلام طلب تسجيلك بنجاح وهو قيد المراجعة من قِبل الإدارة.\n` +
            `سيتم إشعارك فور تفعيل حسابك.\n\n` +
            `لأي استفسار أو دعم فني، يمكنك التواصل معنا مباشرةً على هذا الرقم وسيتولى فريقنا مساعدتك. 💬\n\n` +
            `---\n` +
            `Hello ${fullName} 👋\n` +
            `Welcome to *Vita Health System* 🏥\n\n` +
            `Your registration request has been received and is under admin review.\n` +
            `You will be notified once your account is activated.\n\n` +
            `For any inquiries or technical support, feel free to message us on this number and our team will assist you. 💬`;

          let cleanNumber = mobile.replace(/\D/g, '').replace(/^0+/, '');
          if (!cleanNumber.startsWith('970') && !cleanNumber.startsWith('972')) {
            cleanNumber = '970' + cleanNumber;
          }
          const phone970 = cleanNumber.replace(/^972/, '970');
          const phone972 = cleanNumber.replace(/^970/, '972');
          try { await sendWhatsAppMessage(phone970, welcomeMsg); } catch {}
          try { await sendWhatsAppMessage(phone972, welcomeMsg); } catch {}
        }
      } catch (waErr) {
        console.error('Welcome WhatsApp message failed:', waErr.message);
      }
      
      // Auto-generate token so pharmacy can login immediately
      const token = jwt.sign(
        { userId: newUser._id, role: newUser.role },
        process.env.JWT_SECRET || 'your-secret-key',
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
          isPaid: newUser.isPaid,
        },
        token,
      });
    }
    
    // Send verification code via multiple channels
    let sentVia = [];
    
    // Always try WhatsApp if ready
    if (await isWhatsAppReady()) {
      try {
        const whatsappResult = await send2FACode(mobile, verificationCode);
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
      });
    }
    
    res.status(201).json({ 
      success: true, 
      message: 'Account created. Please verify your phone number.',
      requiresVerification: true,
      userId: newUser._id,
      sentVia: sentVia,
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
    const user = await User.findOne({ mobileNumber: mobile });
    
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
          process.env.JWT_SECRET || 'your-secret-key',
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
          process.env.JWT_SECRET || 'your-secret-key',
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
      
      return res.status(400).json({ message: 'Invalid mobile number or password.' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid mobile number or password.' });
    
    // Check if phone is verified
    if (user.isPhoneVerified === false) {
      // Generate new verification code
      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
      const verificationCodeExpiration = Date.now() + 10 * 60 * 1000;
      
      user.phoneVerificationCode = verificationCode;
      user.phoneVerificationCodeExpiration = verificationCodeExpiration;
      await user.save({ validateBeforeSave: false });
      
      // Send verification code via multiple channels
      let sentVia = [];
      
      // Always try WhatsApp if ready
      if (await isWhatsAppReady()) {
        try {
          const whatsappResult = await send2FACode(user.mobileNumber, verificationCode);
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
      process.env.JWT_SECRET || 'your-secret-key',
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
        profileImage: updatedUser.profileImage,
        points: updatedUser.points || 0,
        language: updatedUser.language || 'en',
        specialty: updatedUser.specialty || '',
        managedByClinic: updatedUser.managedByClinic || false,
        clinicId: updatedUser.clinicId || null,
        activationStatus: updatedUser.activationStatus,
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

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "Email not found." });
    }
    // Generate a random 6-digit code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    // Set expiration (e.g., 15 minutes)
    const resetCodeExpiration = Date.now() + 15 * 60 * 1000;
    user.resetCode = resetCode;
    user.resetCodeExpiration = resetCodeExpiration;
    // Save without validating required fields
    await user.save({ validateBeforeSave: false });
    
    // Send the code by email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Vita Verification Code',
      text: `Your verification code is: ${resetCode}`
    };
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Error sending email:", error);
        return res.status(500).json({ message: "Error sending email." });
      }
      res.json({ message: "Verification code sent to your email." });
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Server error." });
  }
};


exports.verifyCode = async (req, res) => {
  try {
    const { email, code } = req.body;
    const user = await User.findOne({ email });
    if (!user || !user.resetCode || !user.resetCodeExpiration) {
      return res.status(404).json({ message: "No reset request found." });
    }
    // Check if the code is expired or invalid
    if (Date.now() > user.resetCodeExpiration || user.resetCode !== code) {
      return res.status(400).json({ message: "Invalid or expired code." });
    }
    // Code is valid: reset the password to 'vita@123'
    const newPassword = 'vita@123';
    // Generate salt and hash the new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    user.password = hashedPassword;
    user.resetCode = undefined;
    user.resetCodeExpiration = undefined;
    // Save without running all validations
    await user.save({ validateBeforeSave: false });
    
    // Send email notification with the new password
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Vita New Password',
      text: `Your password has been reset. Your new password is: ${newPassword}`
    };
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Error sending email:", error);
        // Even if email fails, we consider the reset successful.
      }
    });
    
    res.json({ message: "Verification successful. Your password has been reset and sent to your email." });
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
    
    if (user.phoneVerificationCode !== code) {
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
    
    // Generate new verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationCodeExpiration = Date.now() + 10 * 60 * 1000; // 10 minutes
    
    user.phoneVerificationCode = verificationCode;
    user.phoneVerificationCodeExpiration = verificationCodeExpiration;
    await user.save({ validateBeforeSave: false });
    
    // Send verification code via multiple channels
    let sentVia = [];
    
    // Always try WhatsApp if ready
    if (await isWhatsAppReady()) {
      try {
        const whatsappResult = await send2FACode(user.mobileNumber, verificationCode);
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
      return res.status(500).json({ message: 'Failed to send verification code. Please try again.' });
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
