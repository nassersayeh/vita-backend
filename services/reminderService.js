const Appointment = require('../models/Appointment');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { sendWhatsAppMessage, isWhatsAppReady } = require('./whatsappService');
const admin = require('firebase-admin');

// Helper function to format date for WhatsApp message (bilingual)
const formatAppointmentDate = (date, lang = 'en') => {
  const options = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  const locale = lang === 'ar' ? 'ar-SA' : 'en-US';
  return new Date(date).toLocaleDateString(locale, options);
};

// Helper function to format time only
const formatTime = (date, lang = 'en') => {
  const options = { hour: '2-digit', minute: '2-digit' };
  const locale = lang === 'ar' ? 'ar-SA' : 'en-US';
  return new Date(date).toLocaleTimeString(locale, options);
};

// Send push notification helper
const sendPushNotification = async (token, title, body) => {
  if (!token) return;
  const message = {
    notification: { title, body },
    token,
  };
  try {
    const response = await admin.messaging().send(message);
    console.log('✅ Push notification sent:', response);
  } catch (error) {
    console.error('❌ Push notification error:', error.message);
  }
};

// Get reminder messages (bilingual)
const getReminderMessages = (lang, doctor, patient, appointment, reminderType) => {
  const dateFormatted = formatAppointmentDate(appointment.appointmentDateTime, lang);
  const timeFormatted = formatTime(appointment.appointmentDateTime, lang);
  
  if (reminderType === 'day') {
    // Day-of reminder messages
    if (lang === 'ar') {
      return {
        patientWhatsApp: `🏥 *Vita - تذكير بموعدك اليوم*\n\n` +
          `⏰ لديك موعد اليوم!\n\n` +
          `👨‍⚕️ *الطبيب:* ${doctor.fullName}\n` +
          `${doctor.specialty ? `🩺 *التخصص:* ${doctor.specialty}\n` : ''}` +
          `📅 *الموعد:* ${dateFormatted}\n` +
          `📍 *الموقع:* ${appointment.workplaceName}\n` +
          `${appointment.workplaceAddress ? `🗺️ *العنوان:* ${appointment.workplaceAddress}\n` : ''}` +
          `\n📱 *لإلغاء أو إعادة جدولة الموعد:*\n` +
          `افتح تطبيق Vita واذهب إلى المواعيد\n\n` +
          `_يرجى الحضور قبل 10 دقائق من الموعد._\n\n` +
          `💚 Vita - صحتكم أولويتنا`,
        
        doctorWhatsApp: `🏥 *Vita - تذكير بموعد اليوم*\n\n` +
          `⏰ لديك موعد اليوم!\n\n` +
          `👤 *المريض:* ${patient.fullName}\n` +
          `📱 *رقم التواصل:* ${patient.mobileNumber}\n` +
          `📅 *الموعد:* ${dateFormatted}\n` +
          `📍 *العيادة:* ${appointment.workplaceName}\n` +
          `📝 *سبب الزيارة:* ${appointment.reason}\n\n` +
          `_راجع تطبيق Vita للتفاصيل الكاملة._`,
        
        patientPushTitle: 'تذكير بموعدك اليوم',
        patientPushBody: `موعدك مع د. ${doctor.fullName} اليوم الساعة ${timeFormatted}`,
        
        doctorPushTitle: 'موعد اليوم',
        doctorPushBody: `لديك موعد مع ${patient.fullName} الساعة ${timeFormatted}`,
        
        patientNotification: `تذكير: موعدك مع د. ${doctor.fullName} اليوم الساعة ${timeFormatted} في ${appointment.workplaceName}`,
        doctorNotification: `تذكير: لديك موعد مع المريض ${patient.fullName} اليوم الساعة ${timeFormatted}`
      };
    } else {
      return {
        patientWhatsApp: `🏥 *Vita - Your Appointment Today*\n\n` +
          `⏰ You have an appointment today!\n\n` +
          `👨‍⚕️ *Doctor:* ${doctor.fullName}\n` +
          `${doctor.specialty ? `🩺 *Specialty:* ${doctor.specialty}\n` : ''}` +
          `📅 *Appointment:* ${dateFormatted}\n` +
          `📍 *Location:* ${appointment.workplaceName}\n` +
          `${appointment.workplaceAddress ? `🗺️ *Address:* ${appointment.workplaceAddress}\n` : ''}` +
          `\n📱 *To cancel or reschedule:*\n` +
          `Open the Vita app and go to Appointments\n\n` +
          `_Please arrive 10 minutes early._\n\n` +
          `💚 Vita - Your health is our priority`,
        
        doctorWhatsApp: `🏥 *Vita - Today's Appointment Reminder*\n\n` +
          `⏰ You have an appointment today!\n\n` +
          `👤 *Patient:* ${patient.fullName}\n` +
          `📱 *Contact:* ${patient.mobileNumber}\n` +
          `📅 *Appointment:* ${dateFormatted}\n` +
          `📍 *Clinic:* ${appointment.workplaceName}\n` +
          `📝 *Reason:* ${appointment.reason}\n\n` +
          `_Check your Vita app for full details._`,
        
        patientPushTitle: 'Appointment Reminder - Today',
        patientPushBody: `Your appointment with Dr. ${doctor.fullName} is today at ${timeFormatted}`,
        
        doctorPushTitle: "Today's Appointment",
        doctorPushBody: `You have an appointment with ${patient.fullName} at ${timeFormatted}`,
        
        patientNotification: `Reminder: Your appointment with Dr. ${doctor.fullName} is today at ${timeFormatted} at ${appointment.workplaceName}`,
        doctorNotification: `Reminder: You have an appointment with ${patient.fullName} today at ${timeFormatted}`
      };
    }
  } else {
    // 30-minute reminder messages
    if (lang === 'ar') {
      return {
        patientWhatsApp: `🏥 *Vita - موعدك بعد 30 دقيقة!*\n\n` +
          `⏰ موعدك قريب جداً!\n\n` +
          `👨‍⚕️ *الطبيب:* ${doctor.fullName}\n` +
          `📅 *الموعد:* ${timeFormatted}\n` +
          `📍 *الموقع:* ${appointment.workplaceName}\n` +
          `${appointment.workplaceAddress ? `🗺️ *العنوان:* ${appointment.workplaceAddress}\n` : ''}` +
          `\n⚠️ *لإلغاء الموعد في آخر لحظة:*\n` +
          `اتصل بالعيادة أو افتح تطبيق Vita\n\n` +
          `_يرجى التوجه الآن للوصول في الوقت المحدد._\n\n` +
          `💚 نتمنى لك الصحة والعافية!`,
        
        doctorWhatsApp: `🏥 *Vita - موعد بعد 30 دقيقة*\n\n` +
          `⏰ لديك موعد قريب!\n\n` +
          `👤 *المريض:* ${patient.fullName}\n` +
          `📱 *رقم التواصل:* ${patient.mobileNumber}\n` +
          `📅 *الموعد:* ${timeFormatted}\n` +
          `📍 *العيادة:* ${appointment.workplaceName}\n` +
          `📝 *سبب الزيارة:* ${appointment.reason}`,
        
        patientPushTitle: 'موعدك بعد 30 دقيقة!',
        patientPushBody: `موعدك مع د. ${doctor.fullName} بعد 30 دقيقة`,
        
        doctorPushTitle: 'موعد قريب',
        doctorPushBody: `موعدك مع ${patient.fullName} بعد 30 دقيقة`,
        
        patientNotification: `موعدك مع د. ${doctor.fullName} بعد 30 دقيقة في ${appointment.workplaceName}`,
        doctorNotification: `موعدك مع المريض ${patient.fullName} بعد 30 دقيقة`
      };
    } else {
      return {
        patientWhatsApp: `🏥 *Vita - Your Appointment in 30 Minutes!*\n\n` +
          `⏰ Your appointment is coming up soon!\n\n` +
          `👨‍⚕️ *Doctor:* ${doctor.fullName}\n` +
          `📅 *Time:* ${timeFormatted}\n` +
          `📍 *Location:* ${appointment.workplaceName}\n` +
          `${appointment.workplaceAddress ? `🗺️ *Address:* ${appointment.workplaceAddress}\n` : ''}` +
          `\n⚠️ *To cancel last minute:*\n` +
          `Call the clinic or open the Vita app\n\n` +
          `_Please head out now to arrive on time._\n\n` +
          `💚 Wishing you good health!`,
        
        doctorWhatsApp: `🏥 *Vita - Appointment in 30 Minutes*\n\n` +
          `⏰ You have an upcoming appointment!\n\n` +
          `👤 *Patient:* ${patient.fullName}\n` +
          `📱 *Contact:* ${patient.mobileNumber}\n` +
          `📅 *Time:* ${timeFormatted}\n` +
          `📍 *Clinic:* ${appointment.workplaceName}\n` +
          `📝 *Reason:* ${appointment.reason}`,
        
        patientPushTitle: 'Appointment in 30 Minutes!',
        patientPushBody: `Your appointment with Dr. ${doctor.fullName} is in 30 minutes`,
        
        doctorPushTitle: 'Upcoming Appointment',
        doctorPushBody: `Your appointment with ${patient.fullName} is in 30 minutes`,
        
        patientNotification: `Your appointment with Dr. ${doctor.fullName} is in 30 minutes at ${appointment.workplaceName}`,
        doctorNotification: `Your appointment with ${patient.fullName} is in 30 minutes`
      };
    }
  }
};

// Send reminder to patient and doctor
const sendReminder = async (appointment, doctor, patient, reminderType) => {
  const patientLang = patient.language || 'en';
  const doctorLang = doctor.language || 'en';
  
  const patientMessages = getReminderMessages(patientLang, doctor, patient, appointment, reminderType);
  const doctorMessages = getReminderMessages(doctorLang, doctor, patient, appointment, reminderType);
  
  // Send WhatsApp to patient
  if (isWhatsAppReady() && patient.mobileNumber) {
    try {
      await sendWhatsAppMessage(patient.mobileNumber, patientMessages.patientWhatsApp);
      console.log(`✅ WhatsApp ${reminderType} reminder sent to patient: ${patient.fullName}`);
    } catch (error) {
      console.error(`❌ WhatsApp error (patient):`, error.message);
    }
  }
  
  // Send WhatsApp to doctor
  if (isWhatsAppReady() && doctor.mobileNumber) {
    try {
      await sendWhatsAppMessage(doctor.mobileNumber, doctorMessages.doctorWhatsApp);
      console.log(`✅ WhatsApp ${reminderType} reminder sent to doctor: ${doctor.fullName}`);
    } catch (error) {
      console.error(`❌ WhatsApp error (doctor):`, error.message);
    }
  }
  
  // Send push notification to patient
  if (patient.deviceToken) {
    await sendPushNotification(
      patient.deviceToken,
      patientMessages.patientPushTitle,
      patientMessages.patientPushBody
    );
  }
  
  // Send push notification to doctor
  if (doctor.deviceToken) {
    await sendPushNotification(
      doctor.deviceToken,
      doctorMessages.doctorPushTitle,
      doctorMessages.doctorPushBody
    );
  }
  
  // Create in-app notification for patient
  try {
    await Notification.create({
      user: patient._id,
      type: 'appointment_reminder',
      message: patientMessages.patientNotification,
      relatedId: appointment._id,
    });
  } catch (err) {
    console.error('Error creating patient notification:', err.message);
  }
  
  // Create in-app notification for doctor
  try {
    await Notification.create({
      user: doctor._id,
      type: 'appointment_reminder',
      message: doctorMessages.doctorNotification,
      relatedId: appointment._id,
    });
  } catch (err) {
    console.error('Error creating doctor notification:', err.message);
  }
};

// Check and send day-of reminders (morning reminder for today's appointments)
const sendDayReminders = async () => {
  console.log('🔔 Checking for day-of appointment reminders...');
  
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  
  try {
    // Find appointments for today that haven't received day reminder yet
    const appointments = await Appointment.find({
      appointmentDateTime: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['pending', 'confirmed'] },
      reminderDaySent: { $ne: true }
    }).populate('doctorId', 'fullName specialty mobileNumber deviceToken language')
      .populate('patient', 'fullName mobileNumber deviceToken language');
    
    console.log(`📋 Found ${appointments.length} appointments needing day-of reminders`);
    
    for (const appointment of appointments) {
      const doctor = appointment.doctorId;
      const patient = appointment.patient;
      
      if (!doctor || !patient) {
        console.log(`⚠️ Skipping appointment ${appointment._id}: Missing doctor or patient`);
        continue;
      }
      
      await sendReminder(appointment, doctor, patient, 'day');
      
      // Mark as sent
      appointment.reminderDaySent = true;
      await appointment.save();
      console.log(`✅ Day reminder sent for appointment ${appointment._id}`);
    }
    
    return appointments.length;
  } catch (error) {
    console.error('❌ Error sending day reminders:', error);
    return 0;
  }
};

// Check and send 30-minute reminders
const send30MinReminders = async () => {
  console.log('🔔 Checking for 30-minute appointment reminders...');
  
  const now = new Date();
  const in30Min = new Date(now.getTime() + 30 * 60 * 1000);
  const in35Min = new Date(now.getTime() + 35 * 60 * 1000);
  
  try {
    // Find appointments happening in 30-35 minutes that haven't received 30min reminder
    const appointments = await Appointment.find({
      appointmentDateTime: { $gte: in30Min, $lte: in35Min },
      status: { $in: ['pending', 'confirmed'] },
      reminder30MinSent: { $ne: true }
    }).populate('doctorId', 'fullName specialty mobileNumber deviceToken language')
      .populate('patient', 'fullName mobileNumber deviceToken language');
    
    console.log(`📋 Found ${appointments.length} appointments needing 30-min reminders`);
    
    for (const appointment of appointments) {
      const doctor = appointment.doctorId;
      const patient = appointment.patient;
      
      if (!doctor || !patient) {
        console.log(`⚠️ Skipping appointment ${appointment._id}: Missing doctor or patient`);
        continue;
      }
      
      await sendReminder(appointment, doctor, patient, '30min');
      
      // Mark as sent
      appointment.reminder30MinSent = true;
      await appointment.save();
      console.log(`✅ 30-min reminder sent for appointment ${appointment._id}`);
    }
    
    return appointments.length;
  } catch (error) {
    console.error('❌ Error sending 30-min reminders:', error);
    return 0;
  }
};

// Start reminder scheduler
let reminderInterval = null;

const startReminderScheduler = () => {
  if (reminderInterval) {
    console.log('⚠️ Reminder scheduler already running');
    return;
  }
  
  console.log('🚀 Starting appointment reminder scheduler...');
  
  // Run immediately on start
  sendDayReminders();
  send30MinReminders();
  
  // Then run every 5 minutes
  reminderInterval = setInterval(async () => {
    await sendDayReminders();
    await send30MinReminders();
  }, 5 * 60 * 1000); // Every 5 minutes
  
  console.log('✅ Reminder scheduler started (runs every 5 minutes)');
};

const stopReminderScheduler = () => {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
    console.log('🛑 Reminder scheduler stopped');
  }
};

module.exports = {
  startReminderScheduler,
  stopReminderScheduler,
  sendDayReminders,
  send30MinReminders,
  sendReminder,
  getReminderMessages
};
