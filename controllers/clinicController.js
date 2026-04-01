const Clinic = require('../models/Clinic');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const EPrescription = require('../models/EPrescription');
const Financial = require('../models/Financial');
const MedicalRecord = require('../models/MedicalRecord');
const LabRequest = require('../models/LabRequest');
const NurseNote = require('../models/NurseNote');
const bcrypt = require('bcryptjs');

// Get clinic info for the logged-in clinic owner
exports.getClinicInfo = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    
    let clinic = await Clinic.findOne({ ownerId: clinicOwnerId })
      .populate('doctors.doctorId', 'fullName email mobileNumber profileImage specialty consultationFee rating workplaces workingSchedule activationStatus')
      .populate('staff.userId', 'fullName email mobileNumber profileImage specialty activationStatus');
    
    if (!clinic) {
      // Create clinic if it doesn't exist
      const owner = await User.findById(clinicOwnerId);
      clinic = new Clinic({
        ownerId: clinicOwnerId,
        name: owner.fullName + "'s Clinic",
        doctors: [],
        staff: []
      });
      await clinic.save();
    }
    
    res.status(200).json({
      success: true,
      clinic: {
        _id: clinic._id,
        name: clinic.name,
        description: clinic.description,
        maxDoctors: clinic.maxDoctors,
        doctorCount: clinic.doctors.filter(d => d.status === 'active').length,
        doctors: clinic.doctors.filter(d => d.status === 'active').map(d => ({
          _id: d._id,
          doctorId: d.doctorId._id,
          doctor: d.doctorId,
          status: d.status,
          addedAt: d.addedAt,
          notes: d.notes
        })),
        staff: clinic.staff.filter(s => s.status === 'active').map(s => ({
          _id: s._id,
          userId: s.userId._id,
          user: s.userId,
          role: s.role,
          status: s.status,
          addedAt: s.addedAt,
          notes: s.notes
        })),
        settings: clinic.settings,
        isActive: clinic.isActive,
        createdAt: clinic.createdAt
      }
    });
  } catch (error) {
    console.error('Error fetching clinic info:', error);
    res.status(500).json({ message: 'Failed to fetch clinic info', error: error.message });
  }
};

// Update clinic info
exports.updateClinicInfo = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { name, description, settings } = req.body;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    if (name) clinic.name = name;
    if (description !== undefined) clinic.description = description;
    if (settings) clinic.settings = { ...clinic.settings, ...settings };
    
    await clinic.save();
    
    res.status(200).json({
      success: true,
      message: 'Clinic info updated successfully',
      clinic
    });
  } catch (error) {
    console.error('Error updating clinic info:', error);
    res.status(500).json({ message: 'Failed to update clinic info', error: error.message });
  }
};

// Add a doctor to the clinic
exports.addDoctor = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { fullName, email, mobileNumber, password, specialty, consultationFee, notes } = req.body;
    
    let clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      // Create clinic if doesn't exist
      const owner = await User.findById(clinicOwnerId);
      clinic = new Clinic({
        ownerId: clinicOwnerId,
        name: owner.fullName + "'s Clinic",
        doctors: []
      });
      await clinic.save();
    }
    
    // Check doctor limit
    const activeDoctors = clinic.doctors.filter(d => d.status === 'active');
    if (activeDoctors.length >= clinic.maxDoctors) {
      return res.status(400).json({ message: `Cannot add more than ${clinic.maxDoctors} doctors` });
    }
    
    // Check if email already exists
    let existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already exists' });
    }
    
    // Check if mobile number already exists
    existingUser = await User.findOne({ mobileNumber });
    if (existingUser) {
      return res.status(400).json({ message: 'Mobile number already exists' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Get clinic owner info for country/city defaults
    const clinicOwner = await User.findById(clinicOwnerId);
    
    // Create new doctor user
    const newDoctor = new User({
      fullName,
      email,
      mobileNumber,
      password: hashedPassword,
      role: 'Doctor',
      specialty: specialty || '',
      consultationFee: consultationFee || 0,
      country: clinicOwner.country,
      city: clinicOwner.city,
      address: clinicOwner.address || '',
      idNumber: `CLINIC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      isPhoneVerified: true,
      activationStatus: 'active',
      isPaid: true, // Clinic pays for doctors
      workplaces: [{
        name: clinic.name,
        address: clinicOwner.address || '',
        isActive: true
      }]
    });
    
    await newDoctor.save();
    
    // Add doctor to clinic
    clinic.doctors.push({
      doctorId: newDoctor._id,
      status: 'active',
      notes: notes || ''
    });
    
    await clinic.save();
    
    res.status(201).json({
      success: true,
      message: 'Doctor added successfully',
      doctor: {
        _id: newDoctor._id,
        fullName: newDoctor.fullName,
        email: newDoctor.email,
        mobileNumber: newDoctor.mobileNumber,
        specialty: newDoctor.specialty,
        consultationFee: newDoctor.consultationFee
      }
    });
  } catch (error) {
    console.error('Error adding doctor:', error);
    res.status(500).json({ message: 'Failed to add doctor', error: error.message });
  }
};

// Update doctor info
exports.updateDoctor = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { doctorId } = req.params;
    const { fullName, email, specialty, consultationFee, workingSchedule, workplaces, notes } = req.body;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    // Verify doctor belongs to clinic
    const doctorEntry = clinic.doctors.find(d => 
      d.doctorId.toString() === doctorId && d.status === 'active'
    );
    if (!doctorEntry) {
      return res.status(403).json({ message: 'Doctor not found in your clinic' });
    }
    
    // Update doctor user
    const updateData = {};
    if (fullName) updateData.fullName = fullName;
    if (email) updateData.email = email;
    if (specialty !== undefined) updateData.specialty = specialty;
    if (consultationFee !== undefined) updateData.consultationFee = consultationFee;
    if (workingSchedule) updateData.workingSchedule = workingSchedule;
    if (workplaces) updateData.workplaces = workplaces;
    
    const doctor = await User.findByIdAndUpdate(doctorId, updateData, { new: true });
    
    // Update notes in clinic
    if (notes !== undefined) {
      doctorEntry.notes = notes;
      await clinic.save();
    }
    
    res.status(200).json({
      success: true,
      message: 'Doctor updated successfully',
      doctor: {
        _id: doctor._id,
        fullName: doctor.fullName,
        email: doctor.email,
        mobileNumber: doctor.mobileNumber,
        specialty: doctor.specialty,
        consultationFee: doctor.consultationFee,
        workingSchedule: doctor.workingSchedule,
        workplaces: doctor.workplaces
      }
    });
  } catch (error) {
    console.error('Error updating doctor:', error);
    res.status(500).json({ message: 'Failed to update doctor', error: error.message });
  }
};

// Remove doctor from clinic
exports.removeDoctor = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { doctorId } = req.params;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    const doctorEntry = clinic.doctors.find(d => d.doctorId.toString() === doctorId);
    if (!doctorEntry) {
      return res.status(404).json({ message: 'Doctor not found in clinic' });
    }
    
    doctorEntry.status = 'inactive';
    await clinic.save();
    
    res.status(200).json({
      success: true,
      message: 'Doctor removed from clinic successfully'
    });
  } catch (error) {
    console.error('Error removing doctor:', error);
    res.status(500).json({ message: 'Failed to remove doctor', error: error.message });
  }
};

// Get all patients across all doctors in the clinic
exports.getAllPatients = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { page = 1, limit = 20, search = '' } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    const doctorIds = clinic.doctors
      .filter(d => d.status === 'active')
      .map(d => d.doctorId);
    
    // Collect patient IDs from TWO sources:
    // 1) doctor.patients arrays
    // 2) Appointments for these doctors
    const doctors = await User.find({ _id: { $in: doctorIds } }).select('patients fullName specialty');
    
    const patientIdSet = new Set();
    const doctorMap = {}; // patientId -> [{ doctorId, fullName, specialty }]
    
    for (const doctor of doctors) {
      for (const pid of (doctor.patients || [])) {
        const pidStr = pid.toString();
        patientIdSet.add(pidStr);
        if (!doctorMap[pidStr]) doctorMap[pidStr] = [];
        const alreadyHasDoctor = doctorMap[pidStr].some(d => d._id.toString() === doctor._id.toString());
        if (!alreadyHasDoctor) {
          doctorMap[pidStr].push({ _id: doctor._id, fullName: doctor.fullName, specialty: doctor.specialty });
        }
      }
    }
    
    // Also get patients from appointments
    const appointmentPatientIds = await Appointment.distinct('patient', {
      doctorId: { $in: doctorIds }
    });
    
    for (const pid of appointmentPatientIds) {
      if (pid) {
        const pidStr = pid.toString();
        patientIdSet.add(pidStr);
      }
    }
    
    // Also map appointment patients to their doctors
    if (appointmentPatientIds.length > 0) {
      const appointmentDoctorLinks = await Appointment.aggregate([
        { $match: { doctorId: { $in: doctorIds }, patient: { $in: appointmentPatientIds } } },
        { $group: { _id: { patient: '$patient', doctor: '$doctorId' } } }
      ]);
      
      for (const link of appointmentDoctorLinks) {
        const pidStr = link._id.patient.toString();
        const docId = link._id.doctor.toString();
        if (!doctorMap[pidStr]) doctorMap[pidStr] = [];
        const alreadyHasDoctor = doctorMap[pidStr].some(d => d._id.toString() === docId);
        if (!alreadyHasDoctor) {
          const doc = doctors.find(d => d._id.toString() === docId);
          if (doc) {
            doctorMap[pidStr].push({ _id: doc._id, fullName: doc.fullName, specialty: doc.specialty });
          }
        }
      }
    }
    
    const allPatientIds = Array.from(patientIdSet);
    
    // Build search query
    const patientQuery = { _id: { $in: allPatientIds } };
    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      patientQuery.$or = [
        { fullName: searchRegex },
        { mobileNumber: searchRegex },
        { idNumber: searchRegex },
        { city: searchRegex }
      ];
    }
    
    // Count total matching
    const totalCount = await User.countDocuments(patientQuery);
    
    // Fetch paginated patients
    const patientDocs = await User.find(patientQuery)
      .select('fullName email mobileNumber profileImage city address birthdate sex idNumber bloodType allergies chronicConditions insuranceProvider insuranceNumber')
      .sort({ fullName: 1 })
      .skip(skip)
      .limit(limitNum);
    
    // Calculate debts for these patients
    const pagePatientIds = patientDocs.map(p => p._id);
    const appointmentDebts = await Appointment.aggregate([
      { $match: { doctorId: { $in: doctorIds }, patient: { $in: pagePatientIds }, debt: { $gt: 0 } } },
      { $group: { _id: '$patient', totalDebt: { $sum: '$debt' } } }
    ]).catch(() => []);
    
    const debtMap = {};
    appointmentDebts.forEach(d => { debtMap[d._id.toString()] = d.totalDebt; });
    
    const patients = patientDocs.map(p => ({
      ...p.toObject(),
      doctors: doctorMap[p._id.toString()] || [],
      totalDebt: debtMap[p._id.toString()] || 0
    }));
    
    res.status(200).json({
      success: true,
      patients,
      totalCount,
      page: pageNum,
      totalPages: Math.ceil(totalCount / limitNum)
    });
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ message: 'Failed to fetch patients', error: error.message });
  }
};

// Get all appointments across all doctors
exports.getAllAppointments = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { startDate, endDate, status, doctorId: filterDoctorId } = req.query;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    let doctorIds = clinic.doctors
      .filter(d => d.status === 'active')
      .map(d => d.doctorId);
    
    // If filtering by specific doctor
    if (filterDoctorId) {
      if (!doctorIds.some(id => id.toString() === filterDoctorId)) {
        return res.status(403).json({ message: 'Doctor not in your clinic' });
      }
      doctorIds = [filterDoctorId];
    }
    
    const query = { doctorId: { $in: doctorIds } };
    
    if (startDate || endDate) {
      query.appointmentDateTime = {};
      if (startDate) query.appointmentDateTime.$gte = new Date(startDate);
      if (endDate) query.appointmentDateTime.$lte = new Date(endDate);
    }
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    const appointments = await Appointment.find(query)
      .populate('patient', 'fullName email mobileNumber profileImage')
      .populate('doctorId', 'fullName specialty profileImage')
      .sort({ appointmentDateTime: -1 });
    
    res.status(200).json({
      success: true,
      appointments
    });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'Failed to fetch appointments', error: error.message });
  }
};

// Create appointment for any doctor in the clinic
exports.createAppointment = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { doctorId, patientId, appointmentDateTime, durationMinutes, notes, appointmentFee, workplaceName } = req.body;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    // Verify doctor belongs to clinic
    const doctorEntry = clinic.doctors.find(d => 
      d.doctorId.toString() === doctorId && d.status === 'active'
    );
    if (!doctorEntry) {
      return res.status(403).json({ message: 'Doctor not in your clinic' });
    }
    
    const appointment = new Appointment({
      doctorId,
      patient: patientId,
      appointmentDateTime: new Date(appointmentDateTime),
      durationMinutes: durationMinutes || 30,
      notes: notes || '',
      appointmentFee: appointmentFee || 0,
      workplaceName: workplaceName || clinic.name || '',
      status: 'scheduled',
      createdBy: clinicOwnerId,
      clinicId: clinic._id
    });
    
    await appointment.save();
    
    // Auto-connect patient to doctor (add to doctor.patients array)
    try {
      const doctor = await User.findById(doctorId);
      if (doctor && !doctor.patients.includes(patientId)) {
        doctor.patients.push(patientId);
        await doctor.save({ validateBeforeSave: false });
      }
    } catch (connectErr) {
      console.error('Auto-connect patient to doctor error:', connectErr);
    }
    
    const populatedAppointment = await Appointment.findById(appointment._id)
      .populate('patient', 'fullName email mobileNumber')
      .populate('doctorId', 'fullName specialty');
    
    res.status(201).json({
      success: true,
      message: 'Appointment created successfully',
      appointment: populatedAppointment
    });
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Failed to create appointment', error: error.message });
  }
};

// Update appointment
exports.updateAppointment = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { appointmentId } = req.params;
    const updates = req.body;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    const doctorIds = clinic.doctors
      .filter(d => d.status === 'active')
      .map(d => d.doctorId.toString());
    
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: 'Appointment not found' });
    }
    
    if (!doctorIds.includes(appointment.doctorId.toString())) {
      return res.status(403).json({ message: 'Appointment doctor not in your clinic' });
    }
    
    // Update allowed fields
    const allowedFields = ['appointmentDateTime', 'durationMinutes', 'notes', 'status', 'appointmentFee', 'workplaceName'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        appointment[field] = updates[field];
      }
    }
    
    await appointment.save();
    
    const populatedAppointment = await Appointment.findById(appointment._id)
      .populate('patient', 'fullName email mobileNumber')
      .populate('doctorId', 'fullName specialty');
    
    res.status(200).json({
      success: true,
      message: 'Appointment updated successfully',
      appointment: populatedAppointment
    });
  } catch (error) {
    console.error('Error updating appointment:', error);
    res.status(500).json({ message: 'Failed to update appointment', error: error.message });
  }
};

// Accept (confirm) an appointment
exports.acceptAppointment = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { appointmentId } = req.params;

    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) return res.status(404).json({ message: 'Clinic not found' });

    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId.toString());

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    if (!doctorIds.includes(appointment.doctorId.toString())) {
      return res.status(403).json({ message: 'Appointment doctor not in your clinic' });
    }

    appointment.status = 'confirmed';
    await appointment.save();

    // Auto-connect patient to doctor
    try {
      const doctor = await User.findById(appointment.doctorId);
      if (doctor && !doctor.patients.includes(appointment.patient)) {
        doctor.patients.push(appointment.patient);
        await doctor.save({ validateBeforeSave: false });
      }
    } catch (connectErr) {
      console.error('Auto-connect error:', connectErr);
    }

    // Notify the patient
    const Notification = require('../models/Notification');
    const patient = await User.findById(appointment.patient);
    const doctor = await User.findById(appointment.doctorId);
    await Notification.create({
      user: appointment.patient,
      type: 'appointment',
      message: `تم قبول موعدك مع الطبيب ${doctor?.fullName || ''} في ${clinic.name}`,
      relatedId: appointment._id,
    });

    // Notify the doctor
    await Notification.create({
      user: appointment.doctorId,
      type: 'appointment',
      message: `تم تأكيد موعد المريض ${patient?.fullName || ''} من قبل العيادة`,
      relatedId: appointment._id,
    });

    const populatedAppointment = await Appointment.findById(appointment._id)
      .populate('patient', 'fullName email mobileNumber profileImage')
      .populate('doctorId', 'fullName specialty profileImage');

    res.status(200).json({ success: true, message: 'تم قبول الموعد بنجاح', appointment: populatedAppointment });
  } catch (error) {
    console.error('Error accepting appointment:', error);
    res.status(500).json({ message: 'Failed to accept appointment', error: error.message });
  }
};

// Decline (cancel) an appointment
exports.declineAppointment = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { appointmentId } = req.params;
    const { reason } = req.body;

    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) return res.status(404).json({ message: 'Clinic not found' });

    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId.toString());

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    if (!doctorIds.includes(appointment.doctorId.toString())) {
      return res.status(403).json({ message: 'Appointment doctor not in your clinic' });
    }

    appointment.status = 'cancelled';
    appointment.isPaid = true;
    appointment.paymentAmount = 0;
    appointment.debt = 0;
    appointment.debtStatus = 'none';
    if (reason) appointment.notes = (appointment.notes ? appointment.notes + '\n' : '') + 'سبب الرفض: ' + reason;
    await appointment.save();

    // Notify the patient
    const Notification = require('../models/Notification');
    const doctor = await User.findById(appointment.doctorId);
    await Notification.create({
      user: appointment.patient,
      type: 'appointment',
      message: `تم رفض موعدك مع الطبيب ${doctor?.fullName || ''} في ${clinic.name}${reason ? '. السبب: ' + reason : ''}`,
      relatedId: appointment._id,
    });

    const populatedAppointment = await Appointment.findById(appointment._id)
      .populate('patient', 'fullName email mobileNumber profileImage')
      .populate('doctorId', 'fullName specialty profileImage');

    res.status(200).json({ success: true, message: 'تم رفض الموعد', appointment: populatedAppointment });
  } catch (error) {
    console.error('Error declining appointment:', error);
    res.status(500).json({ message: 'Failed to decline appointment', error: error.message });
  }
};

// Complete an appointment
exports.completeAppointment = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { appointmentId } = req.params;
    const { appointmentFee } = req.body;

    // Fee is required before completing
    if (appointmentFee === undefined || appointmentFee === null || appointmentFee === '') {
      return res.status(400).json({ message: 'يجب إدخال قيمة الموعد قبل الإتمام' });
    }

    const fee = Number(appointmentFee);
    if (isNaN(fee) || fee < 0) {
      return res.status(400).json({ message: 'قيمة الموعد غير صالحة' });
    }

    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) return res.status(404).json({ message: 'Clinic not found' });

    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId.toString());

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
    if (!doctorIds.includes(appointment.doctorId.toString())) {
      return res.status(403).json({ message: 'Appointment doctor not in your clinic' });
    }

    appointment.status = 'completed';
    appointment.appointmentFee = fee;
    appointment.isPaid = true;
    appointment.paymentAmount = fee;
    appointment.debt = 0;
    appointment.debtStatus = 'none';
    await appointment.save();

    // Update doctor's financial record
    if (fee > 0) {
      try {
        const Financial = require('../models/Financial');
        let financial = await Financial.findOne({ doctorId: appointment.doctorId });
        if (!financial) {
          financial = new Financial({ doctorId: appointment.doctorId, totalEarnings: 0, totalExpenses: 0 });
        }
        financial.transactions.push({
          amount: fee,
          description: `كشفية موعد - ${clinic.name}`,
          date: new Date(),
          patientId: appointment.patient,
          appointmentId: appointment._id,
          paymentMethod: 'Cash',
        });
        financial.totalEarnings = (financial.totalEarnings || 0) + fee;
        await financial.save();
      } catch (finErr) {
        console.error('Error updating doctor financial:', finErr);
      }
    }

    const populatedAppointment = await Appointment.findById(appointment._id)
      .populate('patient', 'fullName email mobileNumber profileImage')
      .populate('doctorId', 'fullName specialty profileImage');

    res.status(200).json({ success: true, message: 'تم إتمام الموعد', appointment: populatedAppointment });
  } catch (error) {
    console.error('Error completing appointment:', error);
    res.status(500).json({ message: 'Failed to complete appointment', error: error.message });
  }
};

// Get all prescriptions across all doctors
exports.getAllPrescriptions = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { doctorId: filterDoctorId } = req.query;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    let doctorIds = clinic.doctors
      .filter(d => d.status === 'active')
      .map(d => d.doctorId);
    
    if (filterDoctorId) {
      if (!doctorIds.some(id => id.toString() === filterDoctorId)) {
        return res.status(403).json({ message: 'Doctor not in your clinic' });
      }
      doctorIds = [filterDoctorId];
    }
    
    const prescriptions = await EPrescription.find({ doctorId: { $in: doctorIds } })
      .populate('patientId', 'fullName email mobileNumber profileImage')
      .populate('doctorId', 'fullName specialty profileImage')
      .sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      prescriptions
    });
  } catch (error) {
    console.error('Error fetching prescriptions:', error);
    res.status(500).json({ message: 'Failed to fetch prescriptions', error: error.message });
  }
};

// Get financial summary for all doctors
exports.getFinancialSummary = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { startDate, endDate, doctorId: filterDoctorId } = req.query;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    let doctorIds = clinic.doctors
      .filter(d => d.status === 'active')
      .map(d => d.doctorId);
    
    if (filterDoctorId) {
      if (!doctorIds.some(id => id.toString() === filterDoctorId)) {
        return res.status(403).json({ message: 'Doctor not in your clinic' });
      }
      doctorIds = [filterDoctorId];
    }
    
    // Get financial records for all doctors AND the clinic owner
    const financialQuery = { doctorId: { $in: [...doctorIds, clinicOwnerId] } };
    const financials = await Financial.find(financialQuery);
    
    // Get appointment revenue
    const appointmentQuery = { doctorId: { $in: doctorIds }, status: 'completed' };
    if (startDate || endDate) {
      appointmentQuery.appointmentDateTime = {};
      if (startDate) appointmentQuery.appointmentDateTime.$gte = new Date(startDate);
      if (endDate) appointmentQuery.appointmentDateTime.$lte = new Date(endDate);
    }
    
    const appointmentRevenue = await Appointment.aggregate([
      { $match: appointmentQuery },
      { $group: { 
        _id: '$doctorId', 
        revenue: { $sum: '$paymentAmount' },
        appointmentCount: { $sum: 1 }
      }}
    ]).catch(() => []);
    
    const revenueMap = {};
    appointmentRevenue.forEach(r => {
      revenueMap[r._id.toString()] = { revenue: r.revenue, count: r.appointmentCount };
    });
    
    // Calculate aggregated stats
    let totalIncome = 0;
    let totalExpenses = 0;
    let totalDebts = 0;
    
    const doctorFinancialsMap = {};
    
    for (const financial of financials) {
      const doctorIdStr = financial.doctorId.toString();
      const isClinicOwner = doctorIdStr === clinicOwnerId.toString();
      const doctor = await User.findById(financial.doctorId, 'fullName specialty');
      
      // Use 'transactions' (the actual field in Financial model), not 'income'
      const transactionIncome = (financial.transactions || []).reduce((sum, t) => sum + (t.amount || 0), 0);
      const expenses = (financial.expenses || []).reduce((sum, e) => sum + (e.amount || 0), 0);
      const debts = (financial.debts || [])
        .filter(d => d.status !== 'paid')
        .reduce((sum, d) => sum + (d.amount || 0), 0);
      
      // Include appointment revenue in income (clinic owner won't have appointments)
      const apptRev = revenueMap[doctorIdStr] || { revenue: 0, count: 0 };
      const income = transactionIncome + apptRev.revenue;
      
      totalIncome += income;
      totalExpenses += expenses;
      totalDebts += debts;
      
      doctorFinancialsMap[doctorIdStr] = {
        doctorId: financial.doctorId,
        doctorName: isClinicOwner ? (clinic.name || doctor?.fullName || 'Clinic') : (doctor?.fullName || 'Unknown'),
        specialty: isClinicOwner ? 'clinic' : (doctor?.specialty || ''),
        isClinicOwner,
        income,
        expenses,
        debts,
        netIncome: income - expenses,
        appointmentRevenue: apptRev.revenue,
        appointmentCount: apptRev.count
      };
    }
    
    // Add doctors who have appointment revenue but no Financial record
    for (const rev of appointmentRevenue) {
      const doctorIdStr = rev._id.toString();
      if (!doctorFinancialsMap[doctorIdStr]) {
        const doctor = await User.findById(rev._id, 'fullName specialty');
        totalIncome += rev.revenue;
        
        doctorFinancialsMap[doctorIdStr] = {
          doctorId: rev._id,
          doctorName: doctor?.fullName || 'Unknown',
          specialty: doctor?.specialty || '',
          income: rev.revenue,
          expenses: 0,
          debts: 0,
          netIncome: rev.revenue,
          appointmentRevenue: rev.revenue,
          appointmentCount: rev.appointmentCount
        };
      }
    }
    
    const doctorFinancials = Object.values(doctorFinancialsMap);
    
    const totalAppointmentRevenue = appointmentRevenue.reduce((sum, r) => sum + r.revenue, 0);
    const totalAppointments = appointmentRevenue.reduce((sum, r) => sum + r.appointmentCount, 0);
    
    res.status(200).json({
      success: true,
      summary: {
        totalIncome,
        totalExpenses,
        totalDebts,
        netIncome: totalIncome - totalExpenses,
        totalAppointmentRevenue,
        totalAppointments
      },
      doctorFinancials
    });
  } catch (error) {
    console.error('Error fetching financial summary:', error);
    res.status(500).json({ message: 'Failed to fetch financial summary', error: error.message });
  }
};

// Get doctor's schedule
exports.getDoctorSchedule = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { doctorId } = req.params;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    const doctorEntry = clinic.doctors.find(d => 
      d.doctorId.toString() === doctorId && d.status === 'active'
    );
    if (!doctorEntry) {
      return res.status(403).json({ message: 'Doctor not in your clinic' });
    }
    
    const doctor = await User.findById(doctorId, 'fullName workingSchedule workplaces');
    
    res.status(200).json({
      success: true,
      doctor: {
        _id: doctor._id,
        fullName: doctor.fullName,
        workingSchedule: doctor.workingSchedule,
        workplaces: doctor.workplaces
      }
    });
  } catch (error) {
    console.error('Error fetching doctor schedule:', error);
    res.status(500).json({ message: 'Failed to fetch doctor schedule', error: error.message });
  }
};

// Update doctor's schedule
exports.updateDoctorSchedule = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { doctorId } = req.params;
    const { workingSchedule, workplaces } = req.body;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    const doctorEntry = clinic.doctors.find(d => 
      d.doctorId.toString() === doctorId && d.status === 'active'
    );
    if (!doctorEntry) {
      return res.status(403).json({ message: 'Doctor not in your clinic' });
    }
    
    const updateData = {};
    if (workingSchedule) updateData.workingSchedule = workingSchedule;
    if (workplaces) updateData.workplaces = workplaces;
    
    const doctor = await User.findByIdAndUpdate(doctorId, updateData, { new: true });
    
    res.status(200).json({
      success: true,
      message: 'Doctor schedule updated successfully',
      doctor: {
        _id: doctor._id,
        fullName: doctor.fullName,
        workingSchedule: doctor.workingSchedule,
        workplaces: doctor.workplaces
      }
    });
  } catch (error) {
    console.error('Error updating doctor schedule:', error);
    res.status(500).json({ message: 'Failed to update doctor schedule', error: error.message });
  }
};

// Get dashboard stats
exports.getDashboardStats = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    const doctorIds = clinic.doctors
      .filter(d => d.status === 'active')
      .map(d => d.doctorId);
    
    // Get counts
    const doctorCount = doctorIds.length;
    
    // Get patient count
    const doctors = await User.find({ _id: { $in: doctorIds } }, 'patients');
    const allPatientIds = new Set();
    doctors.forEach(d => (d.patients || []).forEach(p => allPatientIds.add(p.toString())));
    const patientCount = allPatientIds.size;
    
    // Get today's appointments
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todayAppointments = await Appointment.countDocuments({
      doctorId: { $in: doctorIds },
      appointmentDateTime: { $gte: today, $lt: tomorrow }
    });
    
    // Get pending appointments
    const pendingAppointments = await Appointment.countDocuments({
      doctorId: { $in: doctorIds },
      status: 'scheduled',
      appointmentDateTime: { $gte: new Date() }
    });
    
    // Get this month's revenue
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthRevenue = await Appointment.aggregate([
      { 
        $match: { 
          doctorId: { $in: doctorIds },
          status: 'completed',
          appointmentDateTime: { $gte: monthStart }
        }
      },
      { $group: { _id: null, total: { $sum: '$paymentAmount' } } }
    ]).catch(() => []);
    
    // Get total prescriptions this month
    const prescriptionCount = await EPrescription.countDocuments({
      doctorId: { $in: doctorIds },
      createdAt: { $gte: monthStart }
    });
    
    res.status(200).json({
      success: true,
      stats: {
        doctorCount,
        patientCount,
        todayAppointments,
        pendingAppointments,
        monthRevenue: monthRevenue[0]?.total || 0,
        prescriptionCount
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard stats', error: error.message });
  }
};

// Reset doctor password
exports.resetDoctorPassword = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { doctorId } = req.params;
    const { newPassword } = req.body;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    const doctorEntry = clinic.doctors.find(d => 
      d.doctorId.toString() === doctorId && d.status === 'active'
    );
    if (!doctorEntry) {
      return res.status(403).json({ message: 'Doctor not in your clinic' });
    }
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    await User.findByIdAndUpdate(doctorId, { password: hashedPassword });
    
    res.status(200).json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ message: 'Failed to reset password', error: error.message });
  }
};

// ==================== STAFF MANAGEMENT ====================

// Add a staff member (Nurse, Accountant, LabTech) to the clinic
exports.addStaff = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { fullName, email, mobileNumber, password, staffRole, notes } = req.body;
    
    if (!['Nurse', 'Accountant', 'LabTech'].includes(staffRole)) {
      return res.status(400).json({ message: 'Invalid staff role. Must be Nurse, Accountant, or LabTech' });
    }
    
    let clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      const owner = await User.findById(clinicOwnerId);
      clinic = new Clinic({
        ownerId: clinicOwnerId,
        name: owner.fullName + "'s Clinic",
        doctors: [],
        staff: []
      });
      await clinic.save();
    }
    
    // Check if mobile number already exists
    let existingUser = await User.findOne({ mobileNumber });
    if (existingUser) {
      return res.status(400).json({ message: 'Mobile number already exists' });
    }
    
    // Check if email already exists
    if (email) {
      existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: 'Email already exists' });
      }
    }
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const clinicOwner = await User.findById(clinicOwnerId);
    
    const newStaff = new User({
      fullName,
      email: email || undefined,
      mobileNumber,
      password: hashedPassword,
      role: staffRole,
      country: clinicOwner.country,
      city: clinicOwner.city,
      address: clinicOwner.address || '',
      idNumber: `CLINIC-STAFF-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      isPhoneVerified: true,
      activationStatus: 'active',
      isPaid: true,
    });
    
    await newStaff.save();
    
    clinic.staff.push({
      userId: newStaff._id,
      role: staffRole,
      status: 'active',
      notes: notes || ''
    });
    
    await clinic.save();
    
    res.status(201).json({
      success: true,
      message: 'Staff member added successfully',
      staff: {
        _id: newStaff._id,
        fullName: newStaff.fullName,
        email: newStaff.email,
        mobileNumber: newStaff.mobileNumber,
        role: staffRole
      }
    });
  } catch (error) {
    console.error('Error adding staff:', error);
    res.status(500).json({ message: 'Failed to add staff member', error: error.message });
  }
};

// Update a staff member
exports.updateStaff = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { staffId } = req.params;
    const { fullName, email, notes } = req.body;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    const staffEntry = clinic.staff.find(s =>
      s.userId.toString() === staffId && s.status === 'active'
    );
    if (!staffEntry) {
      return res.status(404).json({ message: 'Staff member not found in your clinic' });
    }
    
    const updateData = {};
    if (fullName) updateData.fullName = fullName;
    if (email) updateData.email = email;
    
    const staff = await User.findByIdAndUpdate(staffId, updateData, { new: true });
    
    if (notes !== undefined) {
      staffEntry.notes = notes;
      await clinic.save();
    }
    
    res.status(200).json({
      success: true,
      message: 'Staff member updated successfully',
      staff: {
        _id: staff._id,
        fullName: staff.fullName,
        email: staff.email,
        mobileNumber: staff.mobileNumber,
        role: staffEntry.role
      }
    });
  } catch (error) {
    console.error('Error updating staff:', error);
    res.status(500).json({ message: 'Failed to update staff member', error: error.message });
  }
};

// Remove a staff member
exports.removeStaff = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { staffId } = req.params;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    const staffEntry = clinic.staff.find(s => s.userId.toString() === staffId);
    if (!staffEntry) {
      return res.status(404).json({ message: 'Staff member not found in clinic' });
    }
    
    staffEntry.status = 'inactive';
    await clinic.save();
    
    res.status(200).json({
      success: true,
      message: 'Staff member removed from clinic successfully'
    });
  } catch (error) {
    console.error('Error removing staff:', error);
    res.status(500).json({ message: 'Failed to remove staff member', error: error.message });
  }
};

// Reset staff password
exports.resetStaffPassword = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { staffId } = req.params;
    const { newPassword } = req.body;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    const staffEntry = clinic.staff.find(s =>
      s.userId.toString() === staffId && s.status === 'active'
    );
    if (!staffEntry) {
      return res.status(403).json({ message: 'Staff member not in your clinic' });
    }
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    await User.findByIdAndUpdate(staffId, { password: hashedPassword });
    
    res.status(200).json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Error resetting staff password:', error);
    res.status(500).json({ message: 'Failed to reset password', error: error.message });
  }
};

// Get all medical records across all doctors in the clinic
exports.getAllMedicalRecords = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    const { patientId, doctorId: filterDoctorId } = req.query;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    let doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
    
    if (filterDoctorId) {
      if (!doctorIds.some(id => id.toString() === filterDoctorId)) {
        return res.status(403).json({ message: 'Doctor not in your clinic' });
      }
      doctorIds = [filterDoctorId];
    }
    
    const query = { doctor: { $in: doctorIds } };
    if (patientId) query.patient = patientId;
    
    const records = await MedicalRecord.find(query)
      .populate('patient', 'fullName mobileNumber profileImage')
      .populate('doctor', 'fullName specialty')
      .sort({ createdAt: -1 })
      .limit(100);
    
    res.status(200).json({ success: true, records });
  } catch (error) {
    console.error('Error fetching medical records:', error);
    res.status(500).json({ message: 'Failed to fetch medical records', error: error.message });
  }
};

// Get all lab requests across all doctors in the clinic
exports.getAllLabRequests = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
    
    const requests = await LabRequest.find({ doctorId: { $in: doctorIds } })
      .populate('patientId', 'fullName mobileNumber')
      .populate('doctorId', 'fullName specialty')
      .populate('testIds', 'name type category price')
      .sort({ requestDate: -1 });
    
    res.status(200).json({ success: true, requests });
  } catch (error) {
    console.error('Error fetching lab requests:', error);
    res.status(500).json({ message: 'Failed to fetch lab requests', error: error.message });
  }
};

// Get all nurse notes in the clinic
exports.getAllNurseNotes = async (req, res) => {
  try {
    const clinicOwnerId = req.user._id;
    
    const clinic = await Clinic.findOne({ ownerId: clinicOwnerId });
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    const nurseIds = clinic.staff
      .filter(s => s.role === 'Nurse' && s.status === 'active')
      .map(s => s.userId);
    
    const notes = await NurseNote.find({ nurse: { $in: nurseIds } })
      .populate('patient', 'fullName mobileNumber')
      .populate('nurse', 'fullName')
      .populate('assignedDoctor', 'fullName specialty')
      .sort({ createdAt: -1 })
      .limit(100);
    
    res.status(200).json({ success: true, notes });
  } catch (error) {
    console.error('Error fetching nurse notes:', error);
    res.status(500).json({ message: 'Failed to fetch nurse notes', error: error.message });
  }
};
