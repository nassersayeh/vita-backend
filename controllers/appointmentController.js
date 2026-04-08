// Rate provider after completed appointment
exports.rateProvider = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { rating } = req.body;
    if (!appointmentId || typeof rating !== 'number') {
      return res.status(400).json({ success: false, message: 'Missing appointmentId or rating' });
    }
    // Find appointment and ensure it's completed and not already rated
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment || appointment.status !== 'completed') {
      return res.status(400).json({ success: false, message: 'Appointment not found or not completed' });
    }
    if (appointment.isRated) {
      return res.status(400).json({ success: false, message: 'Appointment already rated' });
    }
    // Find provider (doctor)
    const provider = await User.findById(appointment.doctorId);
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }
    // Update provider rating (simple average for now)
    if (!provider.rating) provider.rating = 0;
    if (!provider.ratingsCount) provider.ratingsCount = 0;
    provider.rating = ((provider.rating * provider.ratingsCount) + rating) / (provider.ratingsCount + 1);
    provider.ratingsCount += 1;
    await provider.save();
    // Mark appointment as rated
    appointment.rating = rating;
    appointment.isRated = true;
    await appointment.save();
    return res.json({ success: true, rating: provider.rating });
  } catch (err) {
    console.error('rateProvider error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
const Appointment = require('../models/Appointment');
const Financial = require('../models/Financial');
const Points = require('../models/Points');

const admin = require('firebase-admin');
const User = require('../models/User'); // If you need to fetch the user's device token
const Notification = require('../models/Notification');
const { sendWhatsAppMessage, isWhatsAppReady } = require('../services/whatsappService');

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

// Helper function to send appointment WhatsApp notifications (bilingual)
const sendAppointmentWhatsAppNotifications = async (appointment, doctor, patient) => {
  if (!isWhatsAppReady()) {
    console.log('WhatsApp not ready, skipping notifications');
    return;
  }

  // Get language preferences (default to 'en')
  const patientLang = patient.language || 'en';
  const doctorLang = doctor.language || 'en';

  const patientDate = formatAppointmentDate(appointment.appointmentDateTime, patientLang);
  const doctorDate = formatAppointmentDate(appointment.appointmentDateTime, doctorLang);
  
  // Message for Patient (bilingual)
  let patientMessage;
  if (patientLang === 'ar') {
    patientMessage = `🏥 *Vita - تأكيد الموعد*\n\n` +
      `✅ تم حجز موعدك بنجاح!\n\n` +
      `👨‍⚕️ *الطبيب:* ${doctor.fullName}\n` +
      `${doctor.specialty ? `🩺 *التخصص:* ${doctor.specialty}\n` : ''}` +
      `📅 *التاريخ والوقت:* ${patientDate}\n` +
      `📍 *الموقع:* ${appointment.workplaceName}\n` +
      `${appointment.workplaceAddress ? `🗺️ *العنوان:* ${appointment.workplaceAddress}\n` : ''}` +
      `📝 *سبب الزيارة:* ${appointment.reason}\n` +
      `${appointment.urgency === 'urgent' ? '🚨 *الأولوية:* عاجل\n' : ''}` +
      `\n_يرجى الحضور قبل 10 دقائق من الموعد._\n\n` +
      `شكراً لاختياركم Vita! 💚`;
  } else {
    patientMessage = `🏥 *Vita - Appointment Confirmed*\n\n` +
      `✅ Your appointment has been booked successfully!\n\n` +
      `👨‍⚕️ *Doctor:* ${doctor.fullName}\n` +
      `${doctor.specialty ? `🩺 *Specialty:* ${doctor.specialty}\n` : ''}` +
      `📅 *Date & Time:* ${patientDate}\n` +
      `📍 *Location:* ${appointment.workplaceName}\n` +
      `${appointment.workplaceAddress ? `🗺️ *Address:* ${appointment.workplaceAddress}\n` : ''}` +
      `📝 *Reason:* ${appointment.reason}\n` +
      `${appointment.urgency === 'urgent' ? '🚨 *Priority:* Urgent\n' : ''}` +
      `\n_Please arrive 10 minutes early._\n\n` +
      `Thank you for choosing Vita! 💚`;
  }

  // Message for Doctor (bilingual)
  let doctorMessage;
  if (doctorLang === 'ar') {
    doctorMessage = `🏥 *Vita - موعد جديد*\n\n` +
      `📋 لديك موعد جديد!\n\n` +
      `👤 *المريض:* ${patient.fullName}\n` +
      `📱 *رقم التواصل:* ${patient.mobileNumber}\n` +
      `📅 *التاريخ والوقت:* ${doctorDate}\n` +
      `📍 *العيادة:* ${appointment.workplaceName}\n` +
      `📝 *سبب الزيارة:* ${appointment.reason}\n` +
      `${appointment.notes ? `📄 *ملاحظات:* ${appointment.notes}\n` : ''}` +
      `${appointment.urgency === 'urgent' ? '🚨 *الأولوية:* عاجل\n' : ''}` +
      `\n_راجع تطبيق Vita للمزيد من التفاصيل._`;
  } else {
    doctorMessage = `🏥 *Vita - New Appointment*\n\n` +
      `📋 You have a new appointment!\n\n` +
      `👤 *Patient:* ${patient.fullName}\n` +
      `📱 *Contact:* ${patient.mobileNumber}\n` +
      `📅 *Date & Time:* ${doctorDate}\n` +
      `📍 *Clinic:* ${appointment.workplaceName}\n` +
      `📝 *Reason:* ${appointment.reason}\n` +
      `${appointment.notes ? `📄 *Notes:* ${appointment.notes}\n` : ''}` +
      `${appointment.urgency === 'urgent' ? '🚨 *Priority:* URGENT\n' : ''}` +
      `\n_Check your Vita app for more details._`;
  }

  // Send to Patient
  try {
    if (patient.mobileNumber) {
      await sendWhatsAppMessage(patient.mobileNumber, patientMessage);
      console.log(`✅ WhatsApp sent to patient: ${patient.fullName}`);
    }
  } catch (error) {
    console.error('Failed to send WhatsApp to patient:', error.message);
  }

  // Send to Doctor
  try {
    if (doctor.mobileNumber) {
      await sendWhatsAppMessage(doctor.mobileNumber, doctorMessage);
      console.log(`✅ WhatsApp sent to doctor: ${doctor.fullName}`);
    }
  } catch (error) {
    console.error('Failed to send WhatsApp to doctor:', error.message);
  }
};

const sendPushNotification = async (token, title, body) => {
  const message = {
    notification: { title, body },
    token,
  };
  try {
    const response = await admin.messaging().send(message);
    console.log('Successfully sent push notification:', response);
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
};
exports.createAppointment = async (req, res) => {
  try {
    const { doctorId, patientId, appointmentDate, reason, notes, urgency, status, workplaceName, workplaceAddress, durationMinutes } = req.body;

    // Validate required fields
    const missingFields = [];
    if (!doctorId) missingFields.push('doctorId');
    if (!patientId) missingFields.push('patientId');
    if (!appointmentDate) missingFields.push('appointmentDate');
    if (!reason) missingFields.push('reason');
    if (!workplaceName) missingFields.push('workplaceName');

    if (missingFields.length > 0) {
      return res.status(400).json({ message: `Missing required fields: ${missingFields.join(', ')}` });
    }

    // Validate appointmentDate is in the future
    const appointmentDateTime = new Date(appointmentDate);
    if (isNaN(appointmentDateTime.getTime()) || appointmentDateTime <= new Date()) {
      return res.status(400).json({ message: 'Appointment date must be a valid date in the future' });
    }

    // Validate urgency if provided
    if (urgency && !['normal', 'urgent'].includes(urgency)) {
      return res.status(400).json({ message: 'Invalid urgency value. Must be "normal" or "urgent"' });
    }

    // Check if this time slot is already booked (prevent double booking)
    const existingSlotAppointment = await Appointment.findOne({
      doctorId,
      appointmentDateTime,
      workplaceName,
      status: { $ne: 'cancelled' }
    });
    if (existingSlotAppointment) {
      return res.status(400).json({ message: 'This time slot is already booked. Please select a different time.' });
    }

    // Create new appointment
    const doctor = await User.findById(doctorId);
    const isClinicManaged = doctor?.managedByClinic && doctor?.clinicId;

    const appointment = new Appointment({
      doctorId,
      patient: patientId,
      appointmentDateTime,
      workplaceName,
      workplaceAddress,
      reason,
      notes,
      durationMinutes: durationMinutes === 60 ? 60 : 30, // Default to 30 minutes
      urgency: urgency || 'normal',
      status: status || 'pending',
      // If doctor is clinic-managed, link the appointment to the clinic
      ...(isClinicManaged ? { clinicId: doctor.clinicId } : {}),
    });

    await appointment.save();

    // If clinic-managed, notify the clinic owner
    if (isClinicManaged) {
      try {
        const Clinic = require('../models/Clinic');
        const clinic = await Clinic.findById(doctor.clinicId);
        if (clinic) {
          const patientAccount = await User.findById(patientId);
          await Notification.create({
            user: clinic.ownerId,
            type: 'appointment',
            message: `طلب موعد جديد من المريض ${patientAccount?.fullName || 'غير معروف'} مع الطبيب ${doctor.fullName}`,
            relatedId: appointment._id,
          });
        }
      } catch (clinicErr) {
        console.error('Error notifying clinic:', clinicErr);
      }
    }

    // If appointment is created as cancelled, automatically mark as paid with 0 amount
    if (appointment.status === 'cancelled') {
      appointment.isPaid = true;
      appointment.paymentAmount = 0;
      appointment.debt = 0;
      appointment.debtStatus = 'none';
      await appointment.save();
    }

    // Award 10 points to the patient for creating an appointment
    try {
      let userPoints = await Points.findOne({ userId: patientId });
      if (!userPoints) {
        userPoints = new Points({ userId: patientId });
      }

      const appointmentPoints = 10;
      userPoints.totalPoints += appointmentPoints;
      userPoints.pointsHistory.push({
        points: appointmentPoints,
        action: 'appointment',
        description: `Appointment points - Appointment #${appointment._id}`,
        referenceId: appointment._id
      });

      await userPoints.save();

      // Update user's total points
      const patientAccount = await User.findById(patientId);
      if (patientAccount) {
        patientAccount.totalPoints = userPoints.totalPoints;
        await patientAccount.save({ validateBeforeSave: false });
        console.log(`Awarded 10 points to patient ${patientId} for appointment`);
      }
    } catch (pointsError) {
      console.error('Error awarding appointment points:', pointsError);
      // Don't fail appointment creation if points award fails
    }

    // Fetch patient for notification
    const patientAccount = await User.findById(patientId);
    // Fetch doctor for WhatsApp notification
    const doctorAccount = await User.findById(doctorId);
    
    // Create notification for the doctor
    await Notification.create({
      user: doctorId,
      type: 'appointment',
      message: `لديك موعد جديد مع المريض ${patientAccount?.fullName || 'غير معروف'} في عيادة ${workplaceName}`,
      relatedId: appointment._id,
    });

    // Send WhatsApp notifications to both patient and doctor
    if (patientAccount && doctorAccount) {
      sendAppointmentWhatsAppNotifications(appointment, doctorAccount, patientAccount)
        .catch(err => console.error('WhatsApp notification error:', err));
    }

    res.status(201).json({ message: 'Appointment created successfully', appointment });
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Server error while creating appointment' });
  }
};

// Get appointments for a doctor with populated patient info.
exports.getDoctorAppointments = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const appointments = await Appointment.find({ doctorId })
      .populate('patient', 'fullName profileImage mobileNumber email idNumber city')
      .exec();
    res.json({ appointments });
  } catch (error) {
    console.error('Error fetching doctor appointments:', error);
    res.status(500).json({ message: 'Server error while fetching appointments' });
  }
};
exports.getLatestAppointmentForPatient = async (req, res) => {
  try {
    const { patientId } = req.params;
    const appointment = await Appointment.findOne({ patient: patientId })
      .sort({ appointmentDateTime: -1 })
      .populate('doctorId', 'fullName specialization')
      .populate('patient', 'fullName');
    if (!appointment) {
      return res.status(404).json({ message: 'No appointment found for this patient' });
    }
    res.json({ appointment });
  } catch (error) {
    console.error('Error fetching latest appointment:', error);
    res.status(500).json({ message: 'Server error while fetching latest appointment' });
  }
};

exports.updateAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { appointmentDateTime, reason, notes, urgency, status } = req.body;

    // Validate updates
    if (appointmentDateTime && new Date(appointmentDateTime) <= new Date()) {
      return res.status(400).json({ message: 'Appointment time must be in the future' });
    }
    if (urgency && !['normal', 'urgent'].includes(urgency)) {
      return res.status(400).json({ message: 'Invalid urgency value' });
    }

    const appointment = await Appointment.findByIdAndUpdate(
      appointmentId,
      { appointmentDateTime, reason, notes, urgency, status },
      { new: true, runValidators: true }
    )
      .populate('doctorId', 'fullName')
      .populate('patient', 'fullName');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // If appointment is updated to cancelled, automatically mark as paid with 0 amount
    if (status === 'cancelled') {
      appointment.isPaid = true;
      appointment.paymentAmount = 0;
      appointment.debt = 0;
      appointment.debtStatus = 'none';
      await appointment.save();
    }

    // Send notification if status is updated
    if (status) {
      const user = await User.findById(appointment.patient);
      const userDeviceToken = user ? user.deviceToken : null;

      if (userDeviceToken) {
        const title = 'Appointment Update';
        const body = `Your appointment status has been updated to ${status}.`;
        await sendPushNotification(userDeviceToken, title, body);
      }

      const doctorAccount = await User.findById(appointment.doctorId);
      await Notification.create({
        user: appointment.patient,
        type: 'patientappointment',
        message: `لقد قام ${doctorAccount.fullName || 'غير معروف'} بقبول طلبك`,
        relatedId: appointment._id,
      });

      // Send WhatsApp notification for status update (bilingual)
      if (isWhatsAppReady() && user?.mobileNumber) {
        const userLang = user.language || 'en';
        const appointmentDateFormatted = formatAppointmentDate(appointment.appointmentDateTime, userLang);
        
        let statusMessages;
        if (userLang === 'ar') {
          statusMessages = {
            confirmed: `✅ *تأكيد الموعد*\n\nتم تأكيد موعدك مع د. ${doctorAccount?.fullName || 'طبيبك'}!\n\n📅 ${appointmentDateFormatted}\n📍 ${appointment.workplaceName}\n\n_يرجى الحضور قبل 10 دقائق من الموعد._`,
            cancelled: `❌ *إلغاء الموعد*\n\nتم إلغاء موعدك مع د. ${doctorAccount?.fullName || 'طبيبك'}.\n\nإذا كنت تريد إعادة الحجز، يرجى حجز موعد جديد من خلال تطبيق Vita.`,
            completed: `✅ *اكتمل الموعد*\n\nشكراً لزيارتك د. ${doctorAccount?.fullName || 'طبيبك'}!\n\nنأمل أن تكون قد حظيت بتجربة جيدة. 💚`,
            rescheduled: `📅 *تغيير موعد*\n\nتم تغيير موعدك مع د. ${doctorAccount?.fullName || 'طبيبك'}.\n\n📅 الموعد الجديد: ${appointmentDateFormatted}\n📍 ${appointment.workplaceName}`,
          };
        } else {
          statusMessages = {
            confirmed: `✅ *Appointment Confirmed*\n\nYour appointment with Dr. ${doctorAccount?.fullName || 'your doctor'} has been confirmed!\n\n📅 ${appointmentDateFormatted}\n📍 ${appointment.workplaceName}\n\n_Please arrive 10 minutes early._`,
            cancelled: `❌ *Appointment Cancelled*\n\nYour appointment with Dr. ${doctorAccount?.fullName || 'your doctor'} has been cancelled.\n\nIf you need to reschedule, please book a new appointment through the Vita app.`,
            completed: `✅ *Appointment Completed*\n\nThank you for visiting Dr. ${doctorAccount?.fullName || 'your doctor'}!\n\nWe hope you had a good experience. 💚`,
            rescheduled: `📅 *Appointment Rescheduled*\n\nYour appointment with Dr. ${doctorAccount?.fullName || 'your doctor'} has been rescheduled.\n\n📅 New Date: ${appointmentDateFormatted}\n📍 ${appointment.workplaceName}`,
          };
        }

        const message = statusMessages[status];
        if (message) {
          sendWhatsAppMessage(user.mobileNumber, message)
            .catch(err => console.error('WhatsApp status update error:', err));
        }
      }
    }

    res.json({ message: 'Appointment updated successfully', appointment });
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({ message: 'Server error while updating appointment' });
  }
};

exports.deleteAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found.' });
    }
    
    const doctorAccount = await User.findById(appointment.doctorId);
    const patientAccount = await User.findById(appointment.patient);

    const deleted = await Appointment.findByIdAndDelete(appointmentId);
    if (!deleted) {
      return res.status(404).json({ message: 'Appointment not found.' });
    }
    
    await Notification.create({
      user: doctorAccount._id,
      type: 'request',
      message: `لقد قام  ${patientAccount?.fullName || 'غير معروف'} بالغاء الموعد`,
      relatedId: appointment._id
    });

    // Send WhatsApp notification to doctor about cancellation (bilingual)
    if (isWhatsAppReady() && doctorAccount?.mobileNumber) {
      const doctorLang = doctorAccount.language || 'en';
      const appointmentDateFormatted = formatAppointmentDate(appointment.appointmentDateTime, doctorLang);
      
      let cancelMessage;
      if (doctorLang === 'ar') {
        cancelMessage = `❌ *إلغاء موعد*\n\n` +
          `قام المريض *${patientAccount?.fullName || 'غير معروف'}* بإلغاء موعده.\n\n` +
          `📅 كان مقرراً في: ${appointmentDateFormatted}\n` +
          `📍 العيادة: ${appointment.workplaceName}\n` +
          `📝 سبب الزيارة: ${appointment.reason}`;
      } else {
        cancelMessage = `❌ *Appointment Cancelled*\n\n` +
          `Patient *${patientAccount?.fullName || 'Unknown'}* has cancelled their appointment.\n\n` +
          `📅 Was scheduled for: ${appointmentDateFormatted}\n` +
          `📍 Clinic: ${appointment.workplaceName}\n` +
          `📝 Reason: ${appointment.reason}`;
      }
      
      sendWhatsAppMessage(doctorAccount.mobileNumber, cancelMessage)
        .catch(err => console.error('WhatsApp cancel notification error:', err));
    }

    res.json({ message: 'Appointment successfully deleted.' });
  } catch (error) {
    console.error('Error deleting appointment:', error);
    res.status(500).json({ message: 'Server error while deleting appointment.' });
  }
};

// Get available dates (per-workplace) for a doctor's workplaces
exports.getAvailableDatesAndTimes = async (req, res) => {
  try {
    const { doctorId, workplaceName } = req.query;

    if (!doctorId) {
      return res.status(400).json({ message: 'doctorId is required' });
    }

    const doctor = await User.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    let workplaces = (doctor.workplaces || []).filter(w => w.isActive !== false);

    if (workplaceName) {
      workplaces = workplaces.filter(w => w.name === workplaceName);
    }

    if (!workplaces.length) {
      return res.json({ workplaces: [], message: 'No workplaces found for this doctor' });
    }

    const today = new Date();
    const daysToCheck = 30;

    const workplacesWithDates = workplaces.map(w => {
      const availableDates = [];
      for (let i = 0; i < daysToCheck; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });

        // Only include days that actually have time slots defined
        const hasSlots = (w.schedule || []).some(s =>
          s.day?.toLowerCase() === dayName.toLowerCase() && Array.isArray(s.timeSlots) && s.timeSlots.length > 0
        );

        if (hasSlots) {
          availableDates.push(date.toISOString().split('T')[0]);
        }
      }

      return {
        name: w.name,
        address: w.address,
        isActive: w.isActive,
        availableDates
      };
    });

    // Combined list (backward compatibility) is union of all workplaces' dates
    const combinedDates = Array.from(new Set(workplacesWithDates.flatMap(w => w.availableDates))).sort();

    res.json({ 
      workplaces: workplacesWithDates,
      availableDates: combinedDates
    });
  } catch (error) {
    console.error('Error fetching available dates and times:', error);
    res.status(500).json({ message: 'Server error while fetching availability' });
  }
};

// Get available time slots for a specific date and workplace
exports.getAvailableTimeSlots = async (req, res) => {
  try {
    const { doctorId, workplaceName, date, excludeAppointmentId } = req.query;

    if (!doctorId || !workplaceName || !date) {
      return res.status(400).json({ message: 'doctorId, workplaceName, and date are required' });
    }

    // Fetch doctor with workplaces
    const doctor = await User.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    // Find the specific workplace
    const workplace = doctor.workplaces.find(w => w.name === workplaceName);
    if (!workplace) {
      return res.status(404).json({ message: 'Workplace not found' });
    }

    // Get day name from date
    const selectedDate = new Date(date);
    const dayName = selectedDate.toLocaleDateString('en-US', { weekday: 'long' });

    // Find schedule for this day
    const daySchedule = workplace.schedule.find(s => 
      s.day.toLowerCase() === dayName.toLowerCase()
    );

    if (!daySchedule || !daySchedule.timeSlots || daySchedule.timeSlots.length === 0) {
      return res.json({ timeSlots: [] });
    }

    try {
      // Fetch existing appointments for this doctor on this date at this workplace
      const appointmentStartOfDay = new Date(selectedDate);
      appointmentStartOfDay.setHours(0, 0, 0, 0);
      
      const appointmentEndOfDay = new Date(selectedDate);
      appointmentEndOfDay.setHours(23, 59, 59, 999);

      // Build query to exclude current appointment if rescheduling
      const appointmentQuery = {
        doctorId,
        appointmentDateTime: {
          $gte: appointmentStartOfDay,
          $lte: appointmentEndOfDay
        },
        workplaceName,
        status: { $ne: 'cancelled' } // Don't count cancelled appointments
      };

      // Exclude the current appointment if rescheduling
      if (excludeAppointmentId) {
        const mongoose = require('mongoose');
        appointmentQuery._id = { $ne: new mongoose.Types.ObjectId(excludeAppointmentId) };
      }

      const existingAppointments = await Appointment.find(appointmentQuery);

      const bookedTimes = existingAppointments.map(apt => {
        const time = new Date(apt.appointmentDateTime);
        const hours = String(time.getHours()).padStart(2, '0');
        const minutes = String(time.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
      });

      // Generate time slots
      const slots = [];
      daySchedule.timeSlots.forEach(slot => {
        const [startHour, startMin] = slot.start.split(':').map(Number);
        const [endHour, endMin] = slot.end.split(':').map(Number);
        
        let currentHour = startHour;
        let currentMin = startMin;

        while (currentHour < endHour || (currentHour === endHour && currentMin < endMin)) {
          const timeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`;
          
          // Check if slot is not already booked
          if (!bookedTimes.includes(timeStr)) {
            slots.push(timeStr);
          }
          
          // Add 30 minutes
          currentMin += 30;
          if (currentMin >= 60) {
            currentMin -= 60;
            currentHour += 1;
          }
        }
      });

      res.json({ timeSlots: slots });
    } catch (error) {
      console.error('Error fetching appointments:', error);
      // If error, show all possible slots
      const slots = [];
      daySchedule.timeSlots.forEach(slot => {
        const [startHour, startMin] = slot.start.split(':').map(Number);
        const [endHour, endMin] = slot.end.split(':').map(Number);
        
        let currentHour = startHour;
        let currentMin = startMin;

        while (currentHour < endHour || (currentHour === endHour && currentMin < endMin)) {
          slots.push(`${String(currentHour).padStart(2, '0')}:${String(currentMin).padStart(2, '0')}`);
          
          currentMin += 30;
          if (currentMin >= 60) {
            currentMin -= 60;
            currentHour += 1;
          }
        }
      });
      res.json({ timeSlots: slots });
    }
  } catch (error) {
    console.error('Error fetching time slots:', error);
    res.status(500).json({ message: 'Server error while fetching time slots' });
  }
};

// Update appointment status (accept, cancel, etc.)
exports.updateAppointmentStatus = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { status, blockSlot } = req.body;

    if (!appointmentId) {
      return res.status(400).json({ message: 'appointmentId is required' });
    }

    if (!status || !['pending', 'confirmed', 'completed', 'cancelled', 'no-show'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be pending, confirmed, completed, cancelled, or no-show' });
    }

    // Check if this appointment is clinic-managed
    const existingAppointment = await Appointment.findById(appointmentId);
    if (!existingAppointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // If clinic-managed, allow clinic owner, staff, or the doctor assigned to this appointment
    if (existingAppointment.clinicId && req.user) {
      const Clinic = require('../models/Clinic');
      const clinic = await Clinic.findById(existingAppointment.clinicId);
      if (clinic) {
        const isClinicOwner = clinic.ownerId.toString() === req.user._id.toString();
        const isClinicStaff = clinic.staff.some(s => s.userId.toString() === req.user._id.toString() && s.status === 'active');
        const isAutoComplete = status === 'completed' && existingAppointment.status !== 'cancelled';
        const isAssignedDoctor = existingAppointment.doctorId.toString() === req.user._id.toString();
        
        if (!isClinicOwner && !isClinicStaff && !isAutoComplete && !isAssignedDoctor) {
          return res.status(403).json({ message: 'هذا الموعد تحت إدارة العيادة. لا يمكنك تغيير حالته.' });
        }
      }
    }

    const updateData = { status };
    
    // If blockSlot is true, mark the slot as blocked so it remains unavailable
    if (status === 'cancelled' && blockSlot) {
      updateData.blockedSlot = true;
    }

    const appointment = await Appointment.findByIdAndUpdate(
      appointmentId,
      updateData,
      { new: true }
    ).populate('patient', 'fullName mobileNumber email deviceToken').populate('doctorId', 'fullName');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // If appointment is confirmed, auto-add patient to doctor's patient list
    if (status === 'confirmed') {
      try {
        const { autoConnectPatientToDoctor } = require('./doctorPatientController');
        const doctorId = appointment.doctorId._id || appointment.doctorId;
        const patientId = appointment.patient._id || appointment.patient;
        await autoConnectPatientToDoctor(doctorId.toString(), patientId.toString());
        console.log(`Auto-connected patient ${patientId} to doctor ${doctorId} after appointment confirmation`);
      } catch (connectError) {
        // Don't fail the status update, just log the error
        console.log('Auto-connect note:', connectError.message || 'Patient may already be connected');
      }
    }

    // If appointment is cancelled, automatically mark as paid with 0 amount
    if (status === 'cancelled') {
      appointment.isPaid = true;
      appointment.paymentAmount = 0;
      appointment.debt = 0;
      appointment.debtStatus = 'none';
      await appointment.save();
    }

    // Prepare notification messages
    const appointmentDate = new Date(appointment.appointmentDateTime).toLocaleDateString();
    let notificationMessage = '';
    let pushBody = '';

    if (status === 'confirmed') {
      notificationMessage = `Your appointment with Dr. ${appointment.doctorId?.fullName || 'the doctor'} on ${appointmentDate} has been confirmed`;
      pushBody = `Your appointment on ${appointmentDate} has been confirmed`;
    } else if (status === 'cancelled') {
      notificationMessage = `Your appointment with Dr. ${appointment.doctorId?.fullName || 'the doctor'} on ${appointmentDate} has been cancelled`;
      pushBody = `Your appointment on ${appointmentDate} has been cancelled`;
    } else if (status === 'completed') {
      notificationMessage = `Your appointment with Dr. ${appointment.doctorId?.fullName || 'the doctor'} on ${appointmentDate} has been completed`;
      pushBody = `Your appointment on ${appointmentDate} has been completed`;
    }

    // Create notification in database
    if (notificationMessage) {
      await Notification.create({
        user: appointment.patient._id,
        type: 'appointment',
        message: notificationMessage,
        relatedId: appointment._id,
      });
    }

    // Send push notification to patient about status change
    if (appointment.patient?.deviceToken && pushBody) {
      await sendPushNotification(
        appointment.patient.deviceToken,
        'Appointment Status Update',
        pushBody
      );
    }

    res.json({ message: `Appointment ${status} successfully`, appointment });
  } catch (error) {
    console.error('Error updating appointment status:', error);
    res.status(500).json({ message: 'Server error while updating appointment status' });
  }
};

// Update appointment date and time (reschedule)
exports.updateAppointmentDateTime = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { appointmentDateTime, durationMinutes } = req.body;

    if (!appointmentId) {
      return res.status(400).json({ message: 'appointmentId is required' });
    }

    if (!appointmentDateTime) {
      return res.status(400).json({ message: 'appointmentDateTime is required' });
    }

    const newDateTime = new Date(appointmentDateTime);
    if (isNaN(newDateTime.getTime()) || newDateTime <= new Date()) {
      return res.status(400).json({ message: 'New appointment date must be a valid date in the future' });
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Check if new time slot is already booked (prevent double booking)
    const existingAppointment = await Appointment.findOne({
      doctorId: appointment.doctorId,
      appointmentDateTime: newDateTime,
      workplaceName: appointment.workplaceName,
      status: { $ne: 'cancelled' },
      _id: { $ne: appointmentId },
    });

    if (existingAppointment) {
      return res.status(400).json({ message: 'This time slot is already booked. Please select a different time.' });
    }

    // Reset reminder flags when rescheduling
    appointment.appointmentDateTime = newDateTime;
    if (durationMinutes && [30, 60].includes(durationMinutes)) {
      appointment.durationMinutes = durationMinutes;
    }
    appointment.reminderDaySent = false;
    appointment.reminder30MinSent = false;
    await appointment.save();

    // Populate patient and doctor info for notification
    await appointment.populate('patient', 'fullName mobileNumber email deviceToken');
    await appointment.populate('doctorId', 'fullName');

    const newDate = newDateTime.toLocaleDateString();
    const newTime = newDateTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const notificationMessage = `Your appointment with Dr. ${appointment.doctorId?.fullName || 'the doctor'} has been rescheduled to ${newDate} at ${newTime}`;

    // Create notification in database
    await Notification.create({
      user: appointment.patient._id,
      type: 'appointment',
      message: notificationMessage,
      relatedId: appointment._id,
    });

    // Send push notification to patient about reschedule
    if (appointment.patient?.deviceToken) {
      await sendPushNotification(
        appointment.patient.deviceToken,
        'Appointment Rescheduled',
        `Your appointment has been rescheduled to ${newDate} at ${newTime}`
      );
    }

    res.json({ message: 'Appointment rescheduled successfully', appointment });
  } catch (error) {
    console.error('Error rescheduling appointment:', error);
    res.status(500).json({ message: 'Server error while rescheduling appointment' });
  }
};

// Doctor sets fee and creates debt on patient (for clinic-managed appointments)
exports.setDoctorFeeAndDebt = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { doctorFee } = req.body;

    if (!appointmentId) {
      return res.status(400).json({ message: 'appointmentId is required' });
    }

    if (!doctorFee || Number(doctorFee) <= 0) {
      return res.status(400).json({ message: 'يجب إدخال مبلغ صحيح' });
    }

    const appointment = await Appointment.findById(appointmentId)
      .populate('patient', 'fullName mobileNumber')
      .populate('doctorId', 'fullName consultationFee');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    // Verify the requesting user is the assigned doctor
    if (req.user && appointment.doctorId._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'لا يمكنك تعديل هذا الموعد' });
    }

    const feeAmount = Number(doctorFee);

    // Update appointment with doctor fee (don't overwrite clinic's appointmentFee/clinicFee)
    appointment.doctorFee = feeAmount;
    // Total debt = doctor fee + clinic fee (appointmentFee is the clinic's كشفية)
    const clinicFeeAmount = appointment.clinicFee || appointment.appointmentFee || 0;
    const totalDebt = feeAmount + clinicFeeAmount;
    // Account for any payment already made
    const alreadyPaid = appointment.paymentAmount || 0;
    const remainingDebt = Math.max(0, totalDebt - alreadyPaid);
    appointment.debt = remainingDebt;
    if (remainingDebt <= 0) {
      appointment.debtStatus = 'none';
      appointment.isPaid = true;
    } else if (alreadyPaid > 0) {
      appointment.debtStatus = 'partial';
    } else {
      appointment.debtStatus = 'full';
    }
    await appointment.save();

    // Create debt in financial record
    // For clinic appointments: save to clinic OWNER's financial so the accountant can see it
    // For non-clinic appointments: save to doctor's own financial
    try {
      let financialOwnerId = appointment.doctorId._id;

      if (appointment.clinicId) {
        const Clinic = require('../models/Clinic');
        const clinic = await Clinic.findById(appointment.clinicId);
        if (clinic && clinic.ownerId) {
          financialOwnerId = clinic.ownerId;
        }
      }

      let financial = await Financial.findOne({ doctorId: financialOwnerId });
      if (!financial) {
        financial = new Financial({ doctorId: financialOwnerId });
      }

      // Check if a debt for this appointment already exists
      const existingDebt = financial.debts.find(d => 
        d.description && d.description.includes(appointmentId) && d.status === 'pending'
      );

      if (existingDebt) {
        // Update existing debt amount
        existingDebt.amount = feeAmount;
        existingDebt.description = `رسوم الطبيب - ${appointment.patient?.fullName || 'مريض'} - ${appointmentId}`;
      } else {
        // Add new debt
        financial.debts.push({
          patientId: appointment.patient._id || appointment.patient,
          amount: feeAmount,
          description: `رسوم الطبيب - ${appointment.patient?.fullName || 'مريض'} - ${appointmentId}`,
          date: new Date(),
          status: 'pending',
        });
      }

      financial.markModified('debts');
      await financial.save();
    } catch (financialError) {
      console.error('Error creating debt in financial record:', financialError);
    }

    res.json({ 
      message: 'تم تحديد السعر وإنزال الدين بنجاح',
      appointment,
      doctorFee: feeAmount
    });
  } catch (error) {
    console.error('Error setting doctor fee:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Mark appointment as paid
exports.markAppointmentAsPaid = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { paymentAmount, appointmentFee, debtPayments } = req.body;

    if (!appointmentId) {
      return res.status(400).json({ message: 'appointmentId is required' });
    }

    const appointment = await Appointment.findById(appointmentId)
      .populate('doctorId', 'fullName consultationFee');

    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }

    if (appointment.isPaid) {
      return res.status(400).json({ message: 'Appointment is already marked as paid' });
    }

    const appointmentFeeAmount = Number(appointmentFee ?? 0);
    const additionalPayment = Number(paymentAmount ?? 0);
    const totalPayment = appointmentFeeAmount + additionalPayment;

    // Calculate debt payments
    let totalDebtPayment = 0;
    if (debtPayments && Array.isArray(debtPayments)) {
      for (const debtPayment of debtPayments) {
        totalDebtPayment += Number(debtPayment.amount || 0);
      }
    }

    const grandTotal = totalPayment + totalDebtPayment;

    if (!Number.isFinite(grandTotal) || grandTotal <= 0) {
      return res.status(400).json({ message: 'Total payment amount must be greater than zero.' });
    }

    // Update appointment
    appointment.appointmentFee = appointmentFeeAmount;
    appointment.paymentAmount = grandTotal;
    appointment.debt = 0;
    appointment.debtStatus = 'none';
    appointment.isPaid = true;
    appointment.paidAt = new Date();
    appointment.autoMarkedAsPaid = false;

    await appointment.save();

    // Process debt payments
    if (debtPayments && Array.isArray(debtPayments)) {
      for (const debtPayment of debtPayments) {
        try {
          const financial = await Financial.findOne({ doctorId: appointment.doctorId._id });
          if (financial) {
            const debt = financial.debts.id(debtPayment.debtId);
            if (debt && debt.status !== 'paid') {
              const paymentAmount = Number(debtPayment.amount);
              const remainingAmount = debt.amount - paymentAmount;
              
              if (remainingAmount <= 0) {
                debt.status = 'paid';
                debt.amount = 0;
              } else {
                debt.amount = remainingAmount;
              }

              // Add debt payment transaction
              financial.transactions.push({
                amount: paymentAmount,
                description: `Debt payment during appointment - ${debt.description}`,
                date: new Date(),
                patientId: debt.patientId._id || debt.patientId, // Ensure it's an ObjectId
                paymentMethod: 'Cash',
              });

              financial.totalEarnings += paymentAmount;
              await financial.save();
            }
          }
        } catch (debtError) {
          console.error('Error processing debt payment:', debtError);
        }
      }
    }

    // Add appointment payment to doctor's financial record
    try {
      let financial = await Financial.findOne({ doctorId: appointment.doctorId._id });
      
      if (!financial) {
        financial = new Financial({ doctorId: appointment.doctorId._id });
        await financial.save();
      }

      // Add the appointment payment as a transaction
      if (totalPayment > 0) {
        financial.transactions.push({
          amount: totalPayment,
          description: `Appointment payment - ${appointment.reason || 'Consultation'}`,
          date: new Date(),
          patientId: appointment.patient,
          appointmentId: appointment._id,
          paymentMethod: 'Cash',
        });

        financial.totalEarnings += totalPayment;
        await financial.save();
      }
    } catch (financialError) {
      console.error('Error updating financial record:', financialError);
      // Don't fail the appointment payment if financial update fails
    }

    res.json({ 
      message: 'Appointment marked as paid successfully', 
      appointment 
    });
  } catch (error) {
    console.error('Error marking appointment as paid:', error);
    res.status(500).json({ message: 'Server error while marking appointment as paid' });
  }
};

// Auto-mark confirmed appointments as paid after 24 hours
exports.autoMarkAppointmentsAsPaid = async (req, res) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Find confirmed appointments older than 24 hours that are not paid
    const appointments = await Appointment.find({
      status: 'confirmed',
      isPaid: false,
      appointmentDateTime: { $lt: twentyFourHoursAgo }
    }).populate('doctorId', 'consultationFee');

    let markedCount = 0;
    for (const appointment of appointments) {
      const amount = appointment.doctorId?.consultationFee || 0;
      
      if (amount > 0) {
        appointment.isPaid = true;
          appointment.paymentAmount = amount;
          appointment.appointmentFee = appointment.appointmentFee || amount;
          appointment.debt = 0;
          appointment.debtStatus = 'none';
          appointment.paidAt = new Date();
          appointment.autoMarkedAsPaid = true;
        await appointment.save();

        // Add payment to doctor's financial record
        try {
          let financial = await Financial.findOne({ doctorId: appointment.doctorId._id });
          
          if (!financial) {
            financial = new Financial({ doctorId: appointment.doctorId._id });
            await financial.save();
          }

          // Add the payment as a transaction
          financial.transactions.push({
            amount: amount,
            description: `Auto-marked appointment payment - ${appointment.reason || 'Consultation'}`,
            date: new Date(),
            patientId: appointment.patient,
            appointmentId: appointment._id,
            paymentMethod: 'Cash',
          });

          financial.totalEarnings += amount;
          await financial.save();
        } catch (financialError) {
          console.error('Error updating financial record for auto-marked appointment:', financialError);
          // Continue with other appointments even if one fails
        }

        markedCount++;
      }
    }

    res.json({ 
      message: `Auto-marked ${markedCount} appointments as paid`,
      markedCount 
    });
  } catch (error) {
    console.error('Error auto-marking appointments:', error);
    res.status(500).json({ message: 'Server error while auto-marking appointments' });
  }
};

// Get doctor's revenue statistics by month
exports.getDoctorRevenueByMonth = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { year } = req.query;

    const targetYear = year ? parseInt(year) : new Date().getFullYear();
    const startOfYear = new Date(targetYear, 0, 1);
    const endOfYear = new Date(targetYear, 11, 31, 23, 59, 59);

    const monthlyData = [];

    for (let month = 0; month < 12; month++) {
      const startOfMonth = new Date(targetYear, month, 1);
      const endOfMonth = new Date(targetYear, month + 1, 0, 23, 59, 59);

      const appointments = await Appointment.find({
        doctorId,
        appointmentDateTime: { $gte: startOfMonth, $lte: endOfMonth }
      }).populate('patient', 'fullName').populate('doctorId', 'consultationFee');

      // Separate paid and unpaid appointments
      const paidAppointments = appointments.filter(apt => apt.isPaid);
      const unpaidAppointments = appointments.filter(apt => !apt.isPaid);

      // Total payments collected this month
      const totalPayments = appointments.reduce((sum, apt) => sum + (apt.paymentAmount || 0), 0);
      
      // Count unique patients
      const uniquePatientIds = new Set(appointments.map(apt => apt.patient?._id?.toString()));
      const uniquePatientCount = uniquePatientIds.size;

      const appointmentCount = appointments.length;

      monthlyData.push({
        month: month + 1,
        monthName: new Date(targetYear, month).toLocaleString('en-US', { month: 'long' }),
        year: targetYear,
        totalRevenue: totalPayments,
        appointmentCount,
        uniquePatientCount,
        paidAppointmentCount: paidAppointments.length,
        unpaidAppointmentCount: unpaidAppointments.length,
        appointments: appointments.map(apt => ({
          _id: apt._id,
          patientName: apt.patient?.fullName || 'Unknown',
          appointmentDateTime: apt.appointmentDateTime,
          paymentAmount: apt.paymentAmount || 0,
          appointmentFee: apt.appointmentFee || apt.doctorId?.consultationFee || 0,
          paidAt: apt.paidAt,
          isPaid: apt.isPaid,
          autoMarkedAsPaid: apt.autoMarkedAsPaid
        }))
      });
    }

    const totalYearlyRevenue = monthlyData.reduce((sum, m) => sum + m.totalRevenue, 0);
    const totalYearlyAppointments = monthlyData.reduce((sum, m) => sum + m.appointmentCount, 0);
    const totalYearlyUniquePatients = monthlyData.reduce((sum, m) => sum + m.uniquePatientCount, 0);
    const totalYearlyPaidAppointments = monthlyData.reduce((sum, m) => sum + m.paidAppointmentCount, 0);
    const totalYearlyUnpaidAppointments = monthlyData.reduce((sum, m) => sum + m.unpaidAppointmentCount, 0);

    res.json({
      year: targetYear,
      totalYearlyRevenue,
      totalYearlyAppointments,
      totalYearlyUniquePatients,
      totalYearlyPaidAppointments,
      totalYearlyUnpaidAppointments,
      monthlyData
    });
  } catch (error) {
    console.error('Error fetching monthly revenue:', error);
    res.status(500).json({ message: 'Server error while fetching monthly revenue' });
  }
};

// Get available dates for doctor's workplace (next 30 days)
exports.getAvailableDatesAndTimes = async (req, res) => {
  try {
    const { doctorId, workplaceName } = req.query;
    
    console.log('getAvailableDatesAndTimes called with:', { doctorId, workplaceName });
    
    if (!doctorId) {
      return res.status(400).json({ message: 'Doctor ID is required' });
    }
    
    // Fetch doctor with workplaces
    const doctor = await User.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }
    
    console.log('Doctor found. Workplaces:', doctor.workplaces?.map(w => ({ name: w.name, isActive: w.isActive, scheduleLength: w.schedule?.length })));
    
    // Get all active workplaces (or filter by workplaceName if provided)
    let workplacesToProcess = (doctor.workplaces || []).filter(w => w.isActive !== false);
    if (workplaceName) {
      workplacesToProcess = workplacesToProcess.filter(w => w.name === workplaceName);
    }
    
    if (workplacesToProcess.length === 0) {
      console.log('No active workplaces found, returning empty');
      return res.json({ availableDates: [], workplaces: [] });
    }
    
    // Helper function to parse time string "HH:MM" to minutes since midnight
    const parseTimeToMinutes = (timeStr) => {
      const [hours, minutes] = timeStr.split(':').map(Number);
      return hours * 60 + minutes;
    };
    
    // Helper function to calculate total 30-minute slots for a day's schedule
    const calculateTotalSlots = (timeSlots) => {
      const SLOT_DURATION = 30;
      let totalSlots = 0;
      for (const slot of timeSlots) {
        const startMinutes = parseTimeToMinutes(slot.start);
        const endMinutes = parseTimeToMinutes(slot.end);
        const slotsInRange = Math.floor((endMinutes - startMinutes) / SLOT_DURATION);
        totalSlots += slotsInRange;
      }
      return totalSlots;
    };
    
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Process each workplace
    const workplacesResult = [];
    const allDatesSet = new Set();
    
    for (const workplace of workplacesToProcess) {
      if (!workplace.schedule || workplace.schedule.length === 0) {
        console.log('Workplace', workplace.name, 'has no schedule, skipping');
        continue;
      }
      
      const workingDays = workplace.schedule.map(s => s.day.toLowerCase());
      console.log('Workplace:', workplace.name, 'Working days:', workingDays);
      
      const workplaceDates = [];
      
      // Generate dates for the next 30 days
      for (let i = 0; i < 30; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dayName = dayNames[date.getDay()];
        
        // Check if doctor works on this day at this workplace
        if (workingDays.includes(dayName)) {
          const daySchedule = workplace.schedule.find(s => s.day.toLowerCase() === dayName);
          
          if (daySchedule?.timeSlots && daySchedule.timeSlots.length > 0) {
            // Create date string in local timezone (YYYY-MM-DD)
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dateString = `${year}-${month}-${day}`;
            
            // Get existing appointments for this date AT THIS WORKPLACE
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
            
            const existingAppointments = await Appointment.find({
              doctorId: doctor._id,
              workplaceName: workplace.name,
              appointmentDateTime: { $gte: startOfDay, $lte: endOfDay },
              $or: [
                { status: { $nin: ['cancelled', 'no-show'] } },
                { status: 'cancelled', blockedSlot: true }
              ]
            });
            
            // Calculate available 30-minute slots (total - booked)
            const totalSlots = calculateTotalSlots(daySchedule.timeSlots);
            const bookedSlots = existingAppointments.length;
            const slotsAvailable = Math.max(0, totalSlots - bookedSlots);
            
            if (slotsAvailable > 0) {
              workplaceDates.push(dateString);
              allDatesSet.add(dateString);
            }
          }
        }
      }
      
      workplacesResult.push({
        name: workplace.name,
        address: workplace.address,
        isActive: workplace.isActive !== false,
        availableDates: workplaceDates
      });
      
      console.log('Workplace:', workplace.name, 'Available dates:', workplaceDates.length);
    }
    
    // Combined dates for backward compatibility
    const combinedDates = Array.from(allDatesSet).sort();
    
    console.log('Returning', workplacesResult.length, 'workplaces with dates');
    
    res.json({ 
      availableDates: combinedDates.map(date => ({
        date,
        displayDate: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        dayName: new Date(date).toLocaleDateString('en-US', { weekday: 'long' })
      })),
      workplaces: workplacesResult
    });
  } catch (error) {
    console.error('Error fetching available dates:', error);
    res.status(500).json({ message: 'Server error while fetching available dates' });
  }
};

// Get available time slots for a specific date and workplace
exports.getAvailableTimeSlots = async (req, res) => {
  try {
    const { doctorId, workplaceName, date, excludeAppointmentId, duration } = req.query;
    
    // Parse duration - defaults to 30 minutes
    const requestedDuration = parseInt(duration) === 60 ? 60 : 30;
    
    console.log('getAvailableTimeSlots called with:', { doctorId, workplaceName, date, duration: requestedDuration });
    
    if (!doctorId || !date) {
      return res.status(400).json({ message: 'Doctor ID and date are required' });
    }
    
    // Fetch doctor with workplaces
    const doctor = await User.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }
    
    console.log('Doctor workplaces:', doctor.workplaces?.map(w => ({ name: w.name, scheduleLength: w.schedule?.length })));
    
    // Parse date carefully to avoid timezone issues
    const [year, month, day] = date.split('-').map(Number);
    const requestedDate = new Date(year, month - 1, day);
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[requestedDate.getDay()];
    
    console.log('Requested date:', requestedDate, 'Day name:', dayName);
    
    // Find workplaces to check - if workplaceName specified, use that; otherwise check ALL active workplaces
    let workplacesToCheck = [];
    if (doctor.workplaces && doctor.workplaces.length > 0) {
      if (workplaceName) {
        const wp = doctor.workplaces.find(w => w.name === workplaceName && w.isActive !== false);
        if (wp) workplacesToCheck = [wp];
      }
      if (workplacesToCheck.length === 0) {
        // No specific workplace or not found - check ALL active workplaces
        workplacesToCheck = doctor.workplaces.filter(w => w.isActive !== false);
      }
    }
    
    console.log('Workplaces to check:', workplacesToCheck.map(w => w.name));
    
    if (workplacesToCheck.length === 0) {
      console.log('No active workplaces found');
      return res.json({ timeSlots: [] });
    }
    
    // Collect all day schedules from all matching workplaces for this day
    const allDayTimeSlots = [];
    for (const wp of workplacesToCheck) {
      if (!wp.schedule) continue;
      const daySchedule = wp.schedule.find(s => s.day.toLowerCase() === dayName);
      if (daySchedule?.timeSlots && daySchedule.timeSlots.length > 0) {
        console.log('Found schedule for day', dayName, 'at workplace', wp.name, '- slots:', daySchedule.timeSlots.length);
        allDayTimeSlots.push(...daySchedule.timeSlots);
      }
    }
    
    if (allDayTimeSlots.length === 0) {
      console.log('No schedule for this day across any workplace');
      return res.json({ timeSlots: [] });
    }
    
    // Get existing appointments for this date
    const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
    const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
    
    console.log('Query date range - startOfDay:', startOfDay.toISOString(), 'endOfDay:', endOfDay.toISOString());
    
    // Convert doctorId to ObjectId if needed
    const mongoose = require('mongoose');
    const doctorObjectId = mongoose.Types.ObjectId.isValid(doctorId) 
      ? new mongoose.Types.ObjectId(doctorId) 
      : doctorId;
    
    const appointmentQuery = {
      doctorId: doctorObjectId,
      appointmentDateTime: { $gte: startOfDay, $lte: endOfDay },
      $or: [
        { status: { $nin: ['cancelled', 'no-show'] } },
        { status: 'cancelled', blockedSlot: true }
      ]
    };
    
    // Exclude a specific appointment if provided (for rescheduling)
    if (excludeAppointmentId) {
      const excludeId = mongoose.Types.ObjectId.isValid(excludeAppointmentId) 
        ? new mongoose.Types.ObjectId(excludeAppointmentId) 
        : excludeAppointmentId;
      appointmentQuery._id = { $ne: excludeId };
    }
    
    console.log('Appointment query:', JSON.stringify(appointmentQuery, null, 2));
    
    const existingAppointments = await Appointment.find(appointmentQuery);
    
    console.log('Found appointments:', existingAppointments.length);
    existingAppointments.forEach(apt => {
      console.log('  Appointment:', apt._id, apt.appointmentDateTime, apt.status, 'duration:', apt.durationMinutes || 30);
    });
    
    // Helper function to parse time string "HH:MM" to minutes since midnight
    const parseTimeToMinutes = (timeStr) => {
      const [hours, minutes] = timeStr.split(':').map(Number);
      return hours * 60 + minutes;
    };
    
    // Helper function to format minutes since midnight to "HH:MM"
    const formatMinutesToTime = (totalMinutes) => {
      const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
      const minutes = (totalMinutes % 60).toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    };
    
    // Build a set of all blocked 30-minute time slots (considering each appointment's duration)
    const blockedTimeSlots = new Set();
    existingAppointments.forEach(apt => {
      const aptTime = new Date(apt.appointmentDateTime);
      const aptStartMinutes = aptTime.getHours() * 60 + aptTime.getMinutes();
      const aptDuration = apt.durationMinutes || 30;
      
      for (let offset = 0; offset < aptDuration; offset += 30) {
        const blockedMinutes = aptStartMinutes + offset;
        blockedTimeSlots.add(blockedMinutes);
      }
    });
    
    console.log('Blocked time slots (minutes):', Array.from(blockedTimeSlots).sort((a, b) => a - b));
    
    // Generate slots based on requested duration from ALL collected time ranges
    const allTimeSlots = [];
    const addedSlotStarts = new Set(); // Prevent duplicate slots from overlapping workplace schedules
    
    for (const scheduleSlot of allDayTimeSlots) {
      const scheduleStartMinutes = parseTimeToMinutes(scheduleSlot.start);
      const scheduleEndMinutes = parseTimeToMinutes(scheduleSlot.end);
      
      for (let slotStart = scheduleStartMinutes; slotStart + requestedDuration <= scheduleEndMinutes; slotStart += requestedDuration) {
        // Skip if already added from another workplace
        if (addedSlotStarts.has(slotStart)) continue;
        addedSlotStarts.add(slotStart);
        
        const slotEnd = slotStart + requestedDuration;
        const startTime = formatMinutesToTime(slotStart);
        const endTime = formatMinutesToTime(slotEnd);
        
        let isBooked = false;
        for (let checkTime = slotStart; checkTime < slotEnd; checkTime += 30) {
          if (blockedTimeSlots.has(checkTime)) {
            isBooked = true;
            break;
          }
        }
        
        allTimeSlots.push({
          start: startTime,
          end: endTime,
          display: `${startTime} - ${endTime}`,
          isAvailable: !isBooked,
          durationMinutes: requestedDuration
        });
      }
    }
    
    // Sort by start time
    allTimeSlots.sort((a, b) => a.start.localeCompare(b.start));
    
    res.json({ timeSlots: allTimeSlots });
  } catch (error) {
    console.error('Error fetching available time slots:', error);
    res.status(500).json({ message: 'Server error while fetching available time slots' });
  }
};