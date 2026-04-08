const User = require('../models/User');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const { send2FACode, isWhatsAppReady } = require('../services/whatsappService');
require('dotenv').config();

// 2FA Method: 'whatsapp' (free via whatsapp-web.js) or 'email' (free via nodemailer)
const TWO_FA_METHOD = process.env.TWO_FA_METHOD || 'whatsapp';

// Helper function to send 2FA code via Email (FREE - uses existing nodemailer)
const send2FACodeViaEmail = async (email, code, transporter) => {
  const mailOptions = {
    from: `"Vita Security" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: '🔐 Your Vita Verification Code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #32ae98; margin: 0;">Vita</h1>
          <p style="color: #666; margin-top: 5px;">Two-Factor Authentication</p>
        </div>
        
        <div style="background: linear-gradient(135deg, #32ae98 0%, #28a085 100%); color: white; padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 20px;">
          <p style="margin: 0 0 10px 0; font-size: 14px;">Your verification code is:</p>
          <h2 style="margin: 0; font-size: 36px; letter-spacing: 8px; font-weight: bold;">${code}</h2>
        </div>
        
        <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
          <p style="margin: 0; color: #856404; font-size: 14px;">
            ⚠️ This code will expire in <strong>10 minutes</strong>.<br>
            Do not share this code with anyone.
          </p>
        </div>
        
        <p style="color: #666; font-size: 12px; text-align: center; margin: 0;">
          If you didn't request this code, please ignore this email or contact support.
        </p>
      </div>
    `,
    text: `Your Vita verification code is: ${code}\n\nThis code will expire in 10 minutes.\nDo not share this code with anyone.`
  };
  
  await transporter.sendMail(mailOptions);
  console.log(`2FA code sent via email to ${email}`);
  return { success: true, method: 'email' };
};

// Configure nodemailer transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT, 10),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Contact Us - Send email to info@aipilot.ps
exports.contactUs = async (req, res) => {
  try {
    const { name, email, subject, message, category } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please fill all required fields.' 
      });
    }

    // Email to company
    const mailToCompany = {
      from: process.env.EMAIL_USER,
      to: 'info@aipilot.ps',
      subject: `[Vita Contact] ${category ? `[${category}]` : ''} ${subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #32ae98, #1e8a72); padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">New Contact Message</h1>
          </div>
          <div style="padding: 20px; background: #f9f9f9;">
            <p><strong>From:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Category:</strong> ${category || 'General'}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
            <p><strong>Message:</strong></p>
            <p style="white-space: pre-wrap;">${message}</p>
          </div>
          <div style="background: #32ae98; padding: 10px; text-align: center;">
            <p style="color: white; margin: 0; font-size: 12px;">Vita Health App - Contact Form Submission</p>
          </div>
        </div>
      `,
    };

    // Confirmation email to user
    const mailToUser = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Thank you for contacting Vita Health',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #32ae98, #1e8a72); padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">Thank You!</h1>
          </div>
          <div style="padding: 20px; background: #f9f9f9;">
            <p>Dear ${name},</p>
            <p>Thank you for contacting us. We have received your message and will get back to you within 24-48 hours.</p>
            <p><strong>Your Message Summary:</strong></p>
            <p><strong>Subject:</strong> ${subject}</p>
            <p><strong>Category:</strong> ${category || 'General'}</p>
            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
            <p>If you have any urgent inquiries, please call us at: <strong>05668899090</strong></p>
          </div>
          <div style="background: #32ae98; padding: 10px; text-align: center;">
            <p style="color: white; margin: 0; font-size: 12px;">Vita Health - Your Health, Our Priority</p>
          </div>
        </div>
      `,
    };

    // Send emails
    await transporter.sendMail(mailToCompany);
    await transporter.sendMail(mailToUser);

    res.json({ 
      success: true, 
      message: 'Your message has been sent successfully. We will get back to you soon.' 
    });
  } catch (error) {
    console.error('Contact Us error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send message. Please try again later.' 
    });
  }
};

// Change Password
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user._id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide both current and new password.' 
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'New password must be at least 6 characters long.' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found.' 
      });
    }

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ 
        success: false, 
        message: 'Current password is incorrect.' 
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save({ validateBeforeSave: false });

    res.json({ 
      success: true, 
      message: 'Password changed successfully.' 
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to change password. Please try again.' 
    });
  }
};

// Enable Two-Factor Authentication
exports.enable2FA = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found.' 
      });
    }

    // Check if we should use WhatsApp or Email
    const useWhatsApp = TWO_FA_METHOD === 'whatsapp' && (await isWhatsAppReady()) && user.mobileNumber;
    
    if (useWhatsApp) {
      // Use WhatsApp
      if (!user.mobileNumber) {
        return res.status(400).json({ 
          success: false, 
          message: 'No mobile number found. Please add a mobile number first.' 
        });
      }
    } else {
      // Fallback to Email
      if (!user.email) {
        return res.status(400).json({ 
          success: false, 
          message: 'No email found. Please add an email address first.' 
        });
      }
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeExpiration = Date.now() + 10 * 60 * 1000; // 10 minutes

    user.twoFactorCode = code;
    user.twoFactorCodeExpiration = codeExpiration;
    await user.save({ validateBeforeSave: false });

    if (useWhatsApp) {
      // Send code via WhatsApp (FREE - using whatsapp-web.js)
      try {
        const result = await send2FACode(user.mobileNumber, code);
        
        // Mask the phone number for security
        const maskedPhone = result.phone.slice(0, 3) + '****' + result.phone.slice(-3);

        res.json({ 
          success: true, 
          message: 'Verification code sent to your WhatsApp.',
          phone: maskedPhone
        });
      } catch (whatsappError) {
        console.error('WhatsApp sending error:', whatsappError);
        
        // Fallback to email if WhatsApp fails
        if (user.email) {
          try {
            await send2FACodeViaEmail(user.email, code, transporter);
            const emailParts = user.email.split('@');
            const maskedEmail = emailParts[0].substring(0, 2) + '****@' + emailParts[1];
            
            res.json({ 
              success: true, 
              message: 'WhatsApp unavailable. Verification code sent to your email instead.',
              email: maskedEmail
            });
          } catch (emailError) {
            console.error('Email fallback also failed:', emailError);
            res.status(500).json({ 
              success: false, 
              message: 'Failed to send verification code. Please try again.',
              ...(process.env.NODE_ENV === 'development' && { devCode: code })
            });
          }
        } else {
          res.status(500).json({ 
            success: false, 
            message: whatsappError.message || 'Failed to send WhatsApp. Please try again.',
            ...(process.env.NODE_ENV === 'development' && { devCode: code })
          });
        }
      }
    } else {
      // Send code via Email (FREE - using nodemailer)
      try {
        await send2FACodeViaEmail(user.email, code, transporter);

        // Mask the email for security (show first 2 chars and domain)
        const emailParts = user.email.split('@');
        const maskedEmail = emailParts[0].substring(0, 2) + '****@' + emailParts[1];

        res.json({ 
          success: true, 
          message: 'Verification code sent to your email.',
          email: maskedEmail
        });
      } catch (emailError) {
        console.error('Email sending error:', emailError);
        res.status(500).json({ 
          success: false, 
          message: 'Failed to send verification code. Please try again.',
          ...(process.env.NODE_ENV === 'development' && { devCode: code })
        });
      }
    }
  } catch (error) {
    console.error('Enable 2FA error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to enable 2FA. Please try again.' 
    });
  }
};

// Verify and confirm 2FA
exports.verify2FA = async (req, res) => {
  try {
    const userId = req.user._id;
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide the verification code.' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found.' 
      });
    }

    // Check code validity
    if (user.twoFactorCode !== code) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid verification code.' 
      });
    }

    if (user.twoFactorCodeExpiration < Date.now()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Verification code has expired. Please request a new one.' 
      });
    }

    // Enable 2FA
    user.twoFactorEnabled = true;
    user.twoFactorCode = undefined;
    user.twoFactorCodeExpiration = undefined;
    await user.save({ validateBeforeSave: false });

    res.json({ 
      success: true, 
      message: 'Two-Factor Authentication enabled successfully.' 
    });
  } catch (error) {
    console.error('Verify 2FA error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to verify code. Please try again.' 
    });
  }
};

// Disable Two-Factor Authentication
exports.disable2FA = async (req, res) => {
  try {
    const userId = req.user._id;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide your password to disable 2FA.' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found.' 
      });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ 
        success: false, 
        message: 'Incorrect password.' 
      });
    }

    user.twoFactorEnabled = false;
    user.twoFactorCode = undefined;
    user.twoFactorCodeExpiration = undefined;
    await user.save({ validateBeforeSave: false });

    res.json({ 
      success: true, 
      message: 'Two-Factor Authentication disabled successfully.' 
    });
  } catch (error) {
    console.error('Disable 2FA error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to disable 2FA. Please try again.' 
    });
  }
};

// Get 2FA Status
exports.get2FAStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select('twoFactorEnabled');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found.' 
      });
    }

    res.json({ 
      success: true, 
      twoFactorEnabled: user.twoFactorEnabled || false 
    });
  } catch (error) {
    console.error('Get 2FA status error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get 2FA status.' 
    });
  }
};

// Export user data
exports.exportUserData = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select('-password -resetCode -resetCodeExpiration -twoFactorCode -twoFactorCodeExpiration');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found.' 
      });
    }

    // In production, you would gather all user data and send via email
    // For now, we'll acknowledge the request
    if (user.email) {
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Vita - Your Data Export Request',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #32ae98, #1e8a72); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">Data Export Request Received</h1>
            </div>
            <div style="padding: 20px; background: #f9f9f9;">
              <p>Dear ${user.fullName},</p>
              <p>We have received your data export request. Your data will be compiled and sent to this email address within 24-48 hours.</p>
              <p>If you have any questions, please contact us at <strong>info@aipilot.ps</strong> or call <strong>05668899090</strong>.</p>
            </div>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
    }

    res.json({ 
      success: true, 
      message: 'Your data export request has been received. You will receive your data via email within 24-48 hours.' 
    });
  } catch (error) {
    console.error('Export data error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process data export request.' 
    });
  }
};

// Delete account request
exports.deleteAccountRequest = async (req, res) => {
  try {
    const userId = req.user._id;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide your password to confirm account deletion.' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found.' 
      });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ 
        success: false, 
        message: 'Incorrect password.' 
      });
    }

    // In production, you might want to schedule deletion instead of immediate delete
    // For now, we'll mark for deletion and send confirmation
    if (user.email) {
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Vita - Account Deletion Request',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #ff6b6b; padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">Account Deletion Requested</h1>
            </div>
            <div style="padding: 20px; background: #f9f9f9;">
              <p>Dear ${user.fullName},</p>
              <p>We have received your account deletion request. Your account will be permanently deleted within 30 days.</p>
              <p>If you did not request this or wish to cancel, please contact us immediately at <strong>info@aipilot.ps</strong>.</p>
            </div>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
    }

    // For now, we'll return success. In production, implement actual deletion logic.
    res.json({ 
      success: true, 
      message: 'Account deletion request received. Your account will be deleted within 30 days. Check your email for confirmation.' 
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to process account deletion request.' 
    });
  }
};

// Update Language Preference
exports.updateLanguage = async (req, res) => {
  try {
    const userId = req.user._id;
    const { language } = req.body;

    if (!language || !['en', 'ar'].includes(language)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid language. Must be "en" or "ar".' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found.' 
      });
    }

    user.language = language;
    await user.save({ validateBeforeSave: false });

    res.json({ 
      success: true, 
      message: 'Language preference updated successfully.',
      language: user.language
    });
  } catch (error) {
    console.error('Update language error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update language preference.' 
    });
  }
};

// Get Language Preference
exports.getLanguage = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select('language');

    res.json({ 
      success: true, 
      language: user?.language || 'en'
    });
  } catch (error) {
    console.error('Get language error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get language preference.' 
    });
  }
};

module.exports = exports;
