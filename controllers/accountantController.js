const User = require('../models/User');
const Clinic = require('../models/Clinic');
const Appointment = require('../models/Appointment');
const Financial = require('../models/Financial');
const LabRequest = require('../models/LabRequest');
const MedicalTest = require('../models/MedicalTest');
const MedicalRecord = require('../models/MedicalRecord');
const bcrypt = require('bcryptjs');

// Get clinic for this accountant
const getClinicForAccountant = async (accountantId) => {
  const clinic = await Clinic.findOne({
    'staff.userId': accountantId,
    'staff.role': 'Accountant',
    'staff.status': 'active'
  });
  return clinic;
};

// Get dashboard stats
exports.getDashboardStats = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    // Get patient count
    const doctors = await User.find({ _id: { $in: doctorIds } }, 'patients');
    const allPatientIds = new Set();
    doctors.forEach(d => (d.patients || []).forEach(p => allPatientIds.add(p.toString())));

    // Today's appointments
    const todayAppointments = await Appointment.countDocuments({
      doctorId: { $in: doctorIds },
      appointmentDateTime: { $gte: today, $lt: tomorrow }
    });

    // Pending payments
    const pendingPayments = await Appointment.countDocuments({
      doctorId: { $in: doctorIds },
      isPaid: false,
      status: { $in: ['confirmed', 'completed'] }
    });

    // Monthly revenue
    const monthRevenue = await Appointment.aggregate([
      {
        $match: {
          doctorId: { $in: doctorIds },
          isPaid: true,
          $or: [
            { paidAt: { $gte: monthStart } },
            { paidAt: { $exists: false }, updatedAt: { $gte: monthStart } },
            { paidAt: null, updatedAt: { $gte: monthStart } }
          ]
        }
      },
      { $group: { _id: null, total: { $sum: '$paymentAmount' } } }
    ]).catch(() => []);

    // Today's revenue
    const todayRevenue = await Appointment.aggregate([
      {
        $match: {
          doctorId: { $in: doctorIds },
          isPaid: true,
          $or: [
            { paidAt: { $gte: today, $lt: tomorrow } },
            { paidAt: { $exists: false }, updatedAt: { $gte: today, $lt: tomorrow } },
            { paidAt: null, updatedAt: { $gte: today, $lt: tomorrow } }
          ]
        }
      },
      { $group: { _id: null, total: { $sum: '$paymentAmount' } } }
    ]).catch(() => []);

    // Total outstanding debts from Appointment model
    const appointmentDebts = await Appointment.aggregate([
      { $match: { doctorId: { $in: doctorIds }, debt: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$debt' } } }
    ]).catch(() => []);

    // Get debts from Financial model for clinic owner AND all doctors
    const clinicOwnerId = clinic.ownerId;
    let financialDebts = 0;
    try {
      const allFinancialIds = [clinicOwnerId, ...doctorIds];
      const allFinancials = await Financial.find({ doctorId: { $in: allFinancialIds } });
      for (const fin of allFinancials) {
        financialDebts += (fin.debts || [])
          .filter(d => d.status === 'pending')
          .reduce((sum, d) => sum + (d.amount || 0), 0);
      }
    } catch (e) { /* ignore */ }

    // Use the higher of the two to avoid double-counting
    const totalDebts = Math.max(appointmentDebts[0]?.total || 0, financialDebts);

    // Also get non-appointment income from Financial.transactions (debt payments, manual payments)
    // These are NOT counted in the Appointment aggregate above
    const clinicOwnerId2 = clinic.ownerId;
    let financialTodayIncome = 0;
    let financialMonthIncome = 0;
    try {
      const ownerFinancial = await Financial.findOne({ doctorId: clinicOwnerId2 });
      if (ownerFinancial && ownerFinancial.transactions) {
        for (const txn of ownerFinancial.transactions) {
          // Skip appointment-linked transactions (already counted from Appointment model)
          if (txn.appointmentId) continue;
          const txnDate = new Date(txn.date);
          if (txnDate >= monthStart && txnDate < tomorrow) {
            financialMonthIncome += txn.amount || 0;
          }
          if (txnDate >= today && txnDate < tomorrow) {
            financialTodayIncome += txn.amount || 0;
          }
        }
      }
    } catch (e) { /* ignore */ }

    res.status(200).json({
      success: true,
      stats: {
        patientCount: allPatientIds.size,
        todayAppointments,
        pendingPayments,
        monthRevenue: (monthRevenue[0]?.total || 0) + financialMonthIncome,
        todayRevenue: (todayRevenue[0]?.total || 0) + financialTodayIncome,
        totalDebts,
        clinicName: clinic.name,
        doctorCount: doctorIds.length
      }
    });
  } catch (error) {
    console.error('Error fetching accountant stats:', error);
    res.status(500).json({ message: 'فشل في جلب الإحصائيات', error: error.message });
  }
};

// Get all patients in the clinic
exports.getPatients = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
    const doctors = await User.find({ _id: { $in: doctorIds } })
      .populate('patients', 'fullName email mobileNumber profileImage city address birthdate sex idNumber maritalStatus emergencyContactName emergencyContactRelation emergencyPhone hasChronicDiseases chronicDiseasesText hasSurgeries surgeriesText hasFamilyDiseases familyDiseasesText hasDrugAllergies drugAllergiesText hasFoodAllergies foodAllergiesText height weight bloodPressure heartRate temperature bloodSugar smoking previousDiseases disabilities');

    const patientsMap = new Map();
    for (const doctor of doctors) {
      for (const patient of (doctor.patients || [])) {
        const patientId = patient._id.toString();
        if (!patientsMap.has(patientId)) {
          patientsMap.set(patientId, {
            ...patient.toObject(),
            doctors: []
          });
        }
        patientsMap.get(patientId).doctors.push({
          _id: doctor._id,
          fullName: doctor.fullName,
          specialty: doctor.specialty
        });
      }
    }

    const patients = Array.from(patientsMap.values());

    res.status(200).json({
      success: true,
      patients,
      totalCount: patients.length
    });
  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({ message: 'فشل في جلب قائمة المرضى', error: error.message });
  }
};

// Register new patient and assign to a doctor
exports.registerPatient = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const { fullName, mobileNumber, idNumber, birthdate, sex, address, country, city, doctorId, password,
      maritalStatus,
      emergencyContactName, emergencyContactRelation, emergencyPhone,
      hasChronicDiseases, chronicDiseasesText,
      hasSurgeries, surgeriesText,
      hasFamilyDiseases, familyDiseasesText,
      hasDrugAllergies, drugAllergiesText,
      hasFoodAllergies, foodAllergiesText,
      height, weight, bloodPressure, heartRate, temperature, bloodSugar,
      smoking, previousDiseases, disabilities
    } = req.body;

    if (!fullName || !mobileNumber || !idNumber) {
      return res.status(400).json({ message: 'يرجى ملء جميع الحقول المطلوبة' });
    }

    // Verify doctor is in the clinic
    const doctorEntry = clinic.doctors.find(d =>
      d.doctorId.toString() === doctorId && d.status === 'active'
    );
    if (doctorId && !doctorEntry) {
      return res.status(403).json({ message: 'الطبيب غير موجود في هذه العيادة' });
    }

    // Check if patient exists by mobile
    let patient = await User.findOne({ mobileNumber });
    
    if (!patient) {
      // Check by ID number
      patient = await User.findOne({ idNumber });
    }

    if (patient) {
      // Patient exists — update medical history fields if provided
      const medicalFields = {
        maritalStatus, emergencyContactName, emergencyContactRelation, emergencyPhone,
        hasChronicDiseases, chronicDiseasesText, hasSurgeries, surgeriesText,
        hasFamilyDiseases, familyDiseasesText, hasDrugAllergies, drugAllergiesText,
        hasFoodAllergies, foodAllergiesText, bloodPressure, heartRate, temperature, bloodSugar,
        smoking, previousDiseases, disabilities
      };
      // Only update fields that are explicitly provided (not undefined)
      const updates = {};
      for (const [key, value] of Object.entries(medicalFields)) {
        if (value !== undefined && value !== null) {
          updates[key] = value;
        }
      }
      if (height) updates.height = Number(height);
      if (weight) updates.weight = Number(weight);
      if (birthdate) updates.birthdate = birthdate;
      if (sex) updates.sex = sex;
      if (address) updates.address = address;
      if (Object.keys(updates).length > 0) {
        await User.findByIdAndUpdate(patient._id, { $set: updates });
      }

      // Add to doctor(s) if needed
      if (doctorId) {
        const doctor = await User.findById(doctorId);
        if (doctor && !doctor.patients.includes(patient._id)) {
          doctor.patients.push(patient._id);
          await doctor.save({ validateBeforeSave: false });
        }
      } else {
        // No specific doctor — add patient to all active clinic doctors
        const activeDoctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
        for (const docId of activeDoctorIds) {
          const doc = await User.findById(docId);
          if (doc && !doc.patients.includes(patient._id)) {
            doc.patients.push(patient._id);
            await doc.save({ validateBeforeSave: false });
          }
        }
      }
      return res.status(200).json({
        success: true,
        message: 'المريض موجود بالفعل وتم ربطه بالطبيب',
        patient: {
          _id: patient._id,
          fullName: patient.fullName,
          mobileNumber: patient.mobileNumber,
          idNumber: patient.idNumber
        },
        isExisting: true
      });
    }

    // Get clinic owner info for defaults
    const clinicOwner = await User.findById(clinic.ownerId);
    const hashedPassword = await bcrypt.hash(password || mobileNumber, 10);

    // Create new patient
    const newPatient = new User({
      fullName,
      mobileNumber,
      idNumber,
      password: hashedPassword,
      role: 'User',
      birthdate,
      sex,
      address: address || clinicOwner.address || '',
      country: country || clinicOwner.country || 'Palestine',
      city: city || clinicOwner.city || '',
      isPhoneVerified: true,
      activationStatus: 'active',
      // New comprehensive fields
      maritalStatus: maritalStatus || '',
      emergencyContactName: emergencyContactName || '',
      emergencyContactRelation: emergencyContactRelation || '',
      emergencyPhone: emergencyPhone || '',
      hasChronicDiseases: hasChronicDiseases || false,
      chronicDiseasesText: chronicDiseasesText || '',
      hasSurgeries: hasSurgeries || false,
      surgeriesText: surgeriesText || '',
      hasFamilyDiseases: hasFamilyDiseases || false,
      familyDiseasesText: familyDiseasesText || '',
      hasDrugAllergies: hasDrugAllergies || false,
      drugAllergiesText: drugAllergiesText || '',
      hasFoodAllergies: hasFoodAllergies || false,
      foodAllergiesText: foodAllergiesText || '',
      height: height ? Number(height) : null,
      weight: weight ? Number(weight) : null,
      bloodPressure: bloodPressure || '',
      heartRate: heartRate || '',
      temperature: temperature || '',
      bloodSugar: bloodSugar || '',
      smoking: smoking || false,
      previousDiseases: previousDiseases || '',
      disabilities: disabilities || '',
    });

    await newPatient.save();

    // Add patient to doctor(s)
    if (doctorId) {
      const doctor = await User.findById(doctorId);
      if (doctor && !doctor.patients.includes(newPatient._id)) {
        doctor.patients.push(newPatient._id);
        await doctor.save({ validateBeforeSave: false });
      }
    } else {
      // No specific doctor — add patient to all active clinic doctors
      const activeDoctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
      for (const docId of activeDoctorIds) {
        const doc = await User.findById(docId);
        if (doc && !doc.patients.includes(newPatient._id)) {
          doc.patients.push(newPatient._id);
          await doc.save({ validateBeforeSave: false });
        }
      }
    }

    res.status(201).json({
      success: true,
      message: 'تم تسجيل المريض بنجاح',
      patient: {
        _id: newPatient._id,
        fullName: newPatient.fullName,
        mobileNumber: newPatient.mobileNumber,
        idNumber: newPatient.idNumber
      },
      isExisting: false
    });
  } catch (error) {
    console.error('Error registering patient:', error);
    res.status(500).json({ message: 'فشل في تسجيل المريض', error: error.message });
  }
};

// Get clinic doctors
exports.getClinicDoctors = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
    const doctors = await User.find(
      { _id: { $in: doctorIds } },
      'fullName specialty profileImage consultationFee'
    );

    res.status(200).json({ success: true, doctors });
  } catch (error) {
    console.error('Error fetching clinic doctors:', error);
    res.status(500).json({ message: 'فشل في جلب قائمة الأطباء', error: error.message });
  }
};

// Create appointment and assign patient to doctor
exports.createAppointment = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const { doctorId, patientId, appointmentDateTime, durationMinutes, notes, appointmentFee, reason } = req.body;

    // Verify doctor is in clinic
    const doctorEntry = clinic.doctors.find(d =>
      d.doctorId.toString() === doctorId && d.status === 'active'
    );
    if (!doctorEntry) {
      return res.status(403).json({ message: 'الطبيب غير موجود في العيادة' });
    }

    // Ensure patient is connected to doctor
    const doctor = await User.findById(doctorId);
    if (doctor && !doctor.patients.includes(patientId)) {
      doctor.patients.push(patientId);
      await doctor.save({ validateBeforeSave: false });
    }

    const clinicFeeAmount = appointmentFee || doctor?.consultationFee || 0;
    const appointment = new Appointment({
      doctorId,
      patient: patientId,
      appointmentDateTime: new Date(appointmentDateTime),
      durationMinutes: durationMinutes || 30,
      notes: notes || '',
      reason: reason || 'كشف عام',
      appointmentFee: clinicFeeAmount,
      clinicFee: clinicFeeAmount,
      debt: clinicFeeAmount,
      debtStatus: clinicFeeAmount > 0 ? 'full' : 'none',
      status: 'confirmed',
      createdBy: accountantId,
      clinicId: clinic._id,
      workplaceName: clinic.name
    });

    await appointment.save();

    // Add clinic fee (كشفية) as debt to the patient
    const fee = clinicFeeAmount;
    if (fee > 0) {
      const clinicOwnerId = clinic.ownerId;
      let financial = await Financial.findOne({ doctorId: clinicOwnerId });
      if (!financial) {
        financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
      }
      financial.debts.push({
        patientId,
        doctorId: doctorId,
        amount: fee,
        description: 'كشفية العيادة - ' + (reason || 'كشف عام'),
        date: new Date(),
        status: 'pending'
      });
      await financial.save();
    }

    const populatedAppointment = await Appointment.findById(appointment._id)
      .populate('patient', 'fullName mobileNumber profileImage')
      .populate('doctorId', 'fullName specialty');

    res.status(201).json({
      success: true,
      message: 'تم إنشاء الموعد بنجاح',
      appointment: populatedAppointment
    });
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'فشل في إنشاء الموعد', error: error.message });
  }
};

// Mark patient as paid
exports.markAsPaid = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة' });
    }

    const { appointmentId } = req.params;
    const { paymentAmount, paymentMethod, debtAmount } = req.body;

    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId.toString());

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ message: 'الموعد غير موجود' });
    }

    if (!doctorIds.includes(appointment.doctorId.toString())) {
      return res.status(403).json({ message: 'الموعد ليس لطبيب في هذه العيادة' });
    }

    // Total fee = doctorFee + clinicFee
    const totalFee = (appointment.doctorFee || 0) + (appointment.clinicFee || appointment.appointmentFee || 0);
    const paid = paymentAmount || totalFee;
    const remaining = totalFee - paid;

    appointment.isPaid = remaining <= 0;
    appointment.paymentAmount = paid;
    appointment.paidAt = new Date();
    appointment.debt = remaining > 0 ? remaining : 0;
    appointment.debtStatus = remaining > 0 ? (paid > 0 ? 'partial' : 'full') : 'none';

    await appointment.save();

    // Record in CLINIC OWNER's financial (not doctor's)
    const clinicOwnerId = clinic.ownerId;
    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
    }

    financial.transactions.push({
      amount: paid,
      description: `دفع موعد - ${appointment.reason || 'كشف'}`,
      date: new Date(),
      patientId: appointment.patient,
      appointmentId: appointment._id,
      paymentMethod: paymentMethod || 'Cash'
    });
    financial.totalEarnings = (financial.totalEarnings || 0) + paid;

    // Clear patient's pending debts FIFO
    const patientId = appointment.patient.toString();
    let paymentPool = paid;
    const patientDebts = financial.debts.filter(d => 
      d.patientId?.toString() === patientId && d.status === 'pending'
    );
    patientDebts.sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const debt of patientDebts) {
      if (paymentPool <= 0) break;
      if (paymentPool >= debt.amount) {
        paymentPool -= debt.amount;
        debt.amount = 0;
        debt.status = 'paid';
      } else {
        debt.amount -= paymentPool;
        paymentPool = 0;
      }
    }

    if (remaining > 0) {
      financial.debts.push({
        patientId: appointment.patient,
        doctorId: appointment.doctorId,
        amount: remaining,
        description: `دين موعد - ${appointment.reason || 'كشف'}`,
        date: new Date(),
        status: 'pending'
      });
    }

    financial.markModified('debts');
    await financial.save();

    // If doctor != clinic owner, add doctor's share to doctor's Financial
    if (appointment.doctorFee > 0 && appointment.doctorId.toString() !== clinicOwnerId.toString()) {
      try {
        let doctorFinancial = await Financial.findOne({ doctorId: appointment.doctorId });
        if (!doctorFinancial) {
          doctorFinancial = new Financial({ doctorId: appointment.doctorId, totalEarnings: 0, totalExpenses: 0 });
        }
        const doctorEntry = clinic.doctors.find(d => d.doctorId.toString() === appointment.doctorId.toString());
        const clinicPercentage = doctorEntry?.clinicPercentage || 0;
        const doctorShare = appointment.doctorFee - Math.round((appointment.doctorFee * clinicPercentage / 100) * 100) / 100;
        if (doctorShare > 0) {
          doctorFinancial.transactions.push({
            amount: doctorShare,
            description: `حصة الطبيب من دفعة موعد - ${clinic.name}`,
            date: new Date(),
            patientId: appointment.patient,
            appointmentId: appointment._id,
            paymentMethod: paymentMethod || 'Cash',
          });
          doctorFinancial.totalEarnings = (doctorFinancial.totalEarnings || 0) + doctorShare;
          await doctorFinancial.save();
        }
      } catch (docFinErr) {
        console.error('Error updating doctor financial:', docFinErr);
      }
    }

    const populatedAppointment = await Appointment.findById(appointmentId)
      .populate('patient', 'fullName mobileNumber')
      .populate('doctorId', 'fullName specialty');

    res.status(200).json({
      success: true,
      message: 'تم تسجيل الدفع بنجاح',
      appointment: populatedAppointment
    });
  } catch (error) {
    console.error('Error marking as paid:', error);
    res.status(500).json({ message: 'فشل في تسجيل الدفع', error: error.message });
  }
};

// Request lab test for a patient
exports.requestLabTest = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة' });
    }

    const { patientId, doctorId, testIds, notes } = req.body;

    if (!patientId || !testIds || testIds.length === 0) {
      return res.status(400).json({ message: 'يجب تحديد المريض والفحوصات المطلوبة' });
    }

    // Find lab tech in clinic staff
    const labTechStaff = clinic.staff.find(s => s.role === 'LabTech' && s.status === 'active');
    const labId = labTechStaff ? labTechStaff.userId : null;

    // Calculate total cost
    const tests = await MedicalTest.find({ _id: { $in: testIds }, isActive: true });
    const totalCost = tests.reduce((sum, t) => sum + (t.price || 0), 0);

    const labRequest = new LabRequest({
      patientId,
      doctorId: doctorId || clinic.doctors[0]?.doctorId,
      labId: labId || clinic.doctors[0]?.doctorId,
      testIds,
      notes,
      totalCost,
      requestedBy: accountantId,
      clinicId: clinic._id,
      approvalStatus: 'approved'
    });

    await labRequest.save();

    res.status(201).json({
      success: true,
      message: 'تم طلب الفحوصات بنجاح',
      labRequest,
      totalCost
    });
  } catch (error) {
    console.error('Error requesting lab test:', error);
    res.status(500).json({ message: 'فشل في طلب الفحوصات', error: error.message });
  }
};

// Mark lab test as paid
exports.markTestAsPaid = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة' });
    }

    const { requestId } = req.params;
    const { paymentAmount, paymentMethod } = req.body;

    const labRequest = await LabRequest.findById(requestId)
      .populate('testIds', 'name price');

    if (!labRequest) {
      return res.status(404).json({ message: 'طلب الفحص غير موجود' });
    }

    const totalCost = labRequest.totalCost || labRequest.testIds.reduce((sum, t) => sum + (t.price || 0), 0);
    labRequest.totalCost = totalCost;
    labRequest.isPaid = true;
    labRequest.paidAmount = paymentAmount || totalCost;
    labRequest.paidAt = new Date();
    labRequest.paidBy = accountantId;

    await labRequest.save();

    // Record in CLINIC OWNER's financial
    const clinicOwnerId = clinic.ownerId;
    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
    }

    const paid = paymentAmount || totalCost;
    financial.transactions.push({
      amount: paid,
      description: `دفع فحوصات مخبرية`,
      date: new Date(),
      patientId: labRequest.patientId,
      paymentMethod: paymentMethod || 'Cash'
    });
    financial.totalEarnings = (financial.totalEarnings || 0) + paid;

    // Clear any pending lab test debts for this patient (FIFO)
    let paymentPool = paid;
    const labDebts = financial.debts.filter(d => 
      d.patientId?.toString() === labRequest.patientId?.toString() && 
      d.status === 'pending' && 
      d.description?.includes('فحوصات مخبرية')
    );
    labDebts.sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const debt of labDebts) {
      if (paymentPool <= 0) break;
      if (paymentPool >= debt.amount) {
        paymentPool -= debt.amount;
        debt.amount = 0;
        debt.status = 'paid';
      } else {
        debt.amount -= paymentPool;
        paymentPool = 0;
      }
    }
    financial.markModified('debts');

    await financial.save();

    res.status(200).json({
      success: true,
      message: 'تم تسجيل دفع الفحوصات بنجاح'
    });
  } catch (error) {
    console.error('Error marking test as paid:', error);
    res.status(500).json({ message: 'فشل في تسجيل الدفع', error: error.message });
  }
};

// Get all appointments for the clinic
exports.getAppointments = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة' });
    }

    const { status, doctorId: filterDoctorId, startDate, endDate } = req.query;

    let doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);

    if (filterDoctorId) {
      doctorIds = doctorIds.filter(id => id.toString() === filterDoctorId);
    }

    const query = { doctorId: { $in: doctorIds } };
    if (status && status !== 'all') query.status = status;
    if (startDate || endDate) {
      query.appointmentDateTime = {};
      if (startDate) query.appointmentDateTime.$gte = new Date(startDate);
      if (endDate) query.appointmentDateTime.$lte = new Date(endDate);
    }

    const appointments = await Appointment.find(query)
      .populate('patient', 'fullName mobileNumber profileImage idNumber')
      .populate('doctorId', 'fullName specialty profileImage consultationFee')
      .sort({ appointmentDateTime: -1 });

    // Enrich appointments with patient debt info
    const clinicOwnerId = clinic.ownerId;
    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    const appointmentsWithDebt = appointments.map(apt => {
      const aptObj = apt.toObject();
      if (financial && apt.patient?._id) {
        const patientDebts = financial.debts.filter(
          d => d.patientId?.toString() === apt.patient._id.toString() && d.status === 'pending'
        );
        aptObj.patientTotalDebt = patientDebts.reduce((sum, d) => sum + d.amount, 0);
        aptObj.patientDebts = patientDebts.map(d => ({
          amount: d.amount,
          description: d.description,
          date: d.date
        }));
      } else {
        aptObj.patientTotalDebt = 0;
        aptObj.patientDebts = [];
      }
      return aptObj;
    });

    res.status(200).json({ success: true, appointments: appointmentsWithDebt });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({ message: 'فشل في جلب المواعيد', error: error.message });
  }
};

// Get monthly income report with full details
exports.getMonthlyReport = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة' });
    }

    const { month, year } = req.query;
    const now = new Date();
    const filterYear = year ? parseInt(year) : now.getFullYear();
    const filterMonth = month ? parseInt(month) : now.getMonth() + 1;

    const startDate = new Date(filterYear, filterMonth - 1, 1);
    const endDate = new Date(filterYear, filterMonth, 0, 23, 59, 59);

    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);

    // Get all paid appointments for the month
    const paidAppointments = await Appointment.find({
      doctorId: { $in: doctorIds },
      isPaid: true,
      $or: [
        { paidAt: { $gte: startDate, $lte: endDate } },
        { paidAt: { $exists: false }, updatedAt: { $gte: startDate, $lte: endDate } },
        { paidAt: null, updatedAt: { $gte: startDate, $lte: endDate } }
      ]
    })
      .populate('patient', 'fullName mobileNumber idNumber')
      .populate('doctorId', 'fullName specialty')
      .sort({ paidAt: -1 });

    // Get lab request payments
    const labPayments = await LabRequest.find({
      doctorId: { $in: doctorIds },
      isPaid: true,
      paidAt: { $gte: startDate, $lte: endDate }
    })
      .populate('patientId', 'fullName mobileNumber')
      .populate('testIds', 'name price');

    // Build detailed report
    const report = [];

    for (const apt of paidAppointments) {
      report.push({
        type: 'appointment',
        date: apt.paidAt || apt.updatedAt || apt.appointmentDateTime,
        patientName: apt.patient?.fullName || 'غير معروف',
        patientMobile: apt.patient?.mobileNumber || '',
        doctorName: apt.doctorId?.fullName || '',
        description: apt.reason || 'كشف',
        amount: apt.paymentAmount,
        debt: apt.debt || 0,
        appointmentId: apt._id
      });
    }

    for (const lab of labPayments) {
      const testNames = (lab.testIds || []).map(t => t.name).join(', ');
      report.push({
        type: 'labTest',
        date: lab.paidAt,
        patientName: lab.patientId?.fullName || 'غير معروف',
        patientMobile: lab.patientId?.mobileNumber || '',
        doctorName: '',
        description: `فحوصات: ${testNames}`,
        amount: lab.paidAmount || lab.totalCost || 0,
        debt: 0,
        labRequestId: lab._id
      });
    }

    // Also include non-appointment Financial.transactions (debt payments, manual payments)
    const clinicOwnerId = clinic.ownerId;
    try {
      const ownerFinancial = await Financial.findOne({ doctorId: clinicOwnerId })
        .populate('transactions.patientId', 'fullName mobileNumber');
      if (ownerFinancial && ownerFinancial.transactions) {
        for (const txn of ownerFinancial.transactions) {
          // Skip appointment-linked transactions (already in report from Appointment query)
          if (txn.appointmentId) continue;
          const txnDate = new Date(txn.date);
          if (txnDate >= startDate && txnDate <= endDate) {
            report.push({
              type: 'payment',
              date: txnDate,
              patientName: txn.patientId?.fullName || 'غير معروف',
              patientMobile: txn.patientId?.mobileNumber || '',
              doctorName: '',
              description: txn.description || 'دفعة',
              amount: txn.amount || 0,
              debt: 0,
              paymentMethod: txn.paymentMethod || 'Cash'
            });
          }
        }
      }
    } catch (e) {
      console.error('Error fetching financial transactions for report:', e);
    }

    // Sort by date
    report.sort((a, b) => new Date(b.date) - new Date(a.date));

    const totalIncome = report.reduce((sum, r) => sum + r.amount, 0);
    const totalDebt = report.reduce((sum, r) => sum + r.debt, 0);

    res.status(200).json({
      success: true,
      report,
      summary: {
        totalIncome,
        totalDebt,
        transactionCount: report.length,
        month: filterMonth,
        year: filterYear
      }
    });
  } catch (error) {
    console.error('Error fetching monthly report:', error);
    res.status(500).json({ message: 'فشل في جلب التقرير الشهري', error: error.message });
  }
};

// Generate patient receipt
exports.getPatientReceipt = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة' });
    }

    const { patientId } = req.params;
    const { startDate, endDate } = req.query;

    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);

    const query = {
      doctorId: { $in: doctorIds },
      patient: patientId,
      isPaid: true
    };

    if (startDate || endDate) {
      query.paidAt = {};
      if (startDate) query.paidAt.$gte = new Date(startDate);
      if (endDate) query.paidAt.$lte = new Date(endDate);
    }

    const appointments = await Appointment.find(query)
      .populate('patient', 'fullName mobileNumber idNumber')
      .populate('doctorId', 'fullName specialty')
      .sort({ paidAt: -1 });

    // Lab tests
    const labQuery = {
      doctorId: { $in: doctorIds },
      patientId,
      isPaid: true
    };
    if (startDate || endDate) {
      labQuery.paidAt = {};
      if (startDate) labQuery.paidAt.$gte = new Date(startDate);
      if (endDate) labQuery.paidAt.$lte = new Date(endDate);
    }

    const labRequests = await LabRequest.find(labQuery)
      .populate('testIds', 'name price');

    const items = [];

    for (const apt of appointments) {
      items.push({
        type: 'كشف طبي',
        description: apt.reason || 'كشف',
        doctor: apt.doctorId?.fullName || '',
        date: apt.paidAt,
        amount: apt.paymentAmount
      });
    }

    for (const lab of labRequests) {
      const testNames = (lab.testIds || []).map(t => t.name).join(', ');
      items.push({
        type: 'فحوصات مخبرية',
        description: testNames,
        doctor: '',
        date: lab.paidAt,
        amount: lab.paidAmount || lab.totalCost || 0
      });
    }

    const patient = await User.findById(patientId, 'fullName mobileNumber idNumber');
    const totalPaid = items.reduce((sum, item) => sum + item.amount, 0);

    // Get patient debt info from clinic owner AND all clinic doctors
    const clinicOwnerId = clinic.ownerId;
    const allFinancialIds = [clinicOwnerId, ...doctorIds];
    const allFinancials = await Financial.find({ doctorId: { $in: allFinancialIds } });
    
    let patientDebts = [];
    let patientTransactions = [];
    for (const fin of allFinancials) {
      const finDebts = (fin.debts || []).filter(d =>
        d.patientId?.toString() === patientId && d.status === 'pending'
      );
      patientDebts = patientDebts.concat(finDebts);
      
      const finTransactions = (fin.transactions || [])
        .filter(t => t.patientId?.toString() === patientId);
      patientTransactions = patientTransactions.concat(finTransactions);
    }
    const totalDebt = patientDebts.reduce((sum, d) => sum + (d.amount || 0), 0);

    // Get latest payments from transactions
    patientTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    patientTransactions = patientTransactions.slice(0, 20);

    for (const txn of patientTransactions) {
      // avoid duplicating appointment items already added
      const alreadyExists = items.some(item =>
        item.amount === txn.amount && item.date && txn.date &&
        Math.abs(new Date(item.date) - new Date(txn.date)) < 60000
      );
      if (!alreadyExists) {
        items.push({
          type: 'دفعة',
          service: txn.description || 'دفعة',
          description: txn.description || 'دفعة',
          date: txn.date,
          amount: txn.amount
        });
      }
    }

    // Sort all items by date descending
    items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    // Recalculate total
    const total = items.reduce((sum, item) => sum + (item.amount || 0), 0);

    res.status(200).json({
      success: true,
      receipt: {
        clinicName: clinic.name,
        patientName: patient?.fullName || '',
        patientPhone: patient?.mobileNumber || '',
        patientId: patient?.idNumber || '',
        patient: patient ? {
          fullName: patient.fullName,
          mobileNumber: patient.mobileNumber,
          idNumber: patient.idNumber
        } : null,
        items: items.map(item => ({
          service: item.type + (item.description ? ' - ' + item.description : ''),
          description: item.description,
          doctor: item.doctor || '',
          date: item.date,
          amount: item.amount
        })),
        total,
        totalDebt,
        debts: patientDebts.map(d => ({
          description: d.description,
          amount: d.amount,
          date: d.date
        })),
        generatedAt: new Date(),
        generatedBy: req.user.fullName
      }
    });
  } catch (error) {
    console.error('Error generating receipt:', error);
    res.status(500).json({ message: 'فشل في إنشاء الإيصال', error: error.message });
  }
};

// Search patient by mobile or ID
exports.searchPatient = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ message: 'يرجى إدخال رقم الجوال أو رقم الهوية' });
    }

    const patients = await User.find({
      role: 'User',
      $or: [
        { mobileNumber: { $regex: q, $options: 'i' } },
        { idNumber: { $regex: q, $options: 'i' } },
        { fullName: { $regex: q, $options: 'i' } }
      ]
    }, 'fullName mobileNumber idNumber profileImage birthdate sex city')
      .limit(10);

    res.status(200).json({ success: true, patients });
  } catch (error) {
    console.error('Error searching patients:', error);
    res.status(500).json({ message: 'فشل في البحث', error: error.message });
  }
};

// Accept appointment (same as clinic owner)
exports.acceptAppointment = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const { appointmentId } = req.params;
    const { appointmentFee } = req.body || {};
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) return res.status(404).json({ message: 'لم يتم العثور على عيادة' });

    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId.toString());
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) return res.status(404).json({ message: 'الموعد غير موجود' });
    if (!doctorIds.includes(appointment.doctorId.toString())) {
      return res.status(403).json({ message: 'طبيب الموعد ليس في عيادتك' });
    }

    appointment.status = 'confirmed';
    // Set appointment fee if provided
    if (appointmentFee !== undefined && appointmentFee !== null && appointmentFee !== '') {
      const fee = Number(appointmentFee);
      if (!isNaN(fee) && fee >= 0) {
        appointment.appointmentFee = fee;
        appointment.clinicFee = fee;
        appointment.debt = fee;
        appointment.debtStatus = fee > 0 ? 'full' : 'none';
      }
    }
    await appointment.save();

    // Add appointment fee as debt to patient (if fee > 0)
    const fee = appointment.clinicFee || appointment.appointmentFee || 0;
    if (fee > 0) {
      const clinicOwnerId = clinic.ownerId;
      let financial = await Financial.findOne({ doctorId: clinicOwnerId });
      if (!financial) {
        financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
      }
      financial.debts.push({
        patientId: appointment.patient,
        doctorId: appointment.doctorId,
        amount: fee,
        description: 'موعد - ' + (appointment.reason || 'كشف عام'),
        date: new Date(),
        status: 'pending'
      });
      financial.markModified('debts');
      await financial.save();
    }

    // Auto-connect patient to doctor
    const doctor = await User.findById(appointment.doctorId);
    const patient = await User.findById(appointment.patient);
    if (doctor && patient) {
      if (!doctor.patients) doctor.patients = [];
      if (!doctor.patients.map(String).includes(patient._id.toString())) {
        doctor.patients.push(patient._id);
        await doctor.save({ validateBeforeSave: false });
      }
    }

    // Notify patient and doctor
    const Notification = require('../models/Notification');
    await Notification.create({
      user: appointment.doctorId,
      type: 'appointment',
      message: `تم تأكيد موعد المريض ${patient?.fullName || ''} من قبل العيادة`,
      relatedId: appointment._id,
    });
    await Notification.create({
      user: appointment.patient,
      type: 'appointment',
      message: `تم قبول موعدك مع الطبيب ${doctor?.fullName || ''} في ${clinic.name}`,
      relatedId: appointment._id,
    });

    const populatedAppointment = await Appointment.findById(appointment._id)
      .populate('patient', 'fullName email mobileNumber profileImage')
      .populate('doctorId', 'fullName specialty profileImage');

    res.status(200).json({ success: true, message: 'تم قبول الموعد بنجاح', appointment: populatedAppointment });
  } catch (error) {
    console.error('Error accepting appointment:', error);
    res.status(500).json({ message: 'فشل في قبول الموعد', error: error.message });
  }
};

// Decline appointment
exports.declineAppointment = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const { appointmentId } = req.params;
    const { reason } = req.body;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) return res.status(404).json({ message: 'لم يتم العثور على عيادة' });

    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId.toString());
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) return res.status(404).json({ message: 'الموعد غير موجود' });
    if (!doctorIds.includes(appointment.doctorId.toString())) {
      return res.status(403).json({ message: 'طبيب الموعد ليس في عيادتك' });
    }

    appointment.status = 'cancelled';
    appointment.isPaid = true;
    appointment.paymentAmount = 0;
    appointment.debt = 0;
    appointment.debtStatus = 'none';
    if (reason) appointment.notes = (appointment.notes ? appointment.notes + '\n' : '') + 'سبب الرفض: ' + reason;
    await appointment.save();

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
    res.status(500).json({ message: 'فشل في رفض الموعد', error: error.message });
  }
};

// Complete appointment with fee
exports.completeAppointment = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const { appointmentId } = req.params;
    const { appointmentFee } = req.body;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) return res.status(404).json({ message: 'لم يتم العثور على عيادة' });

    if (appointmentFee === undefined || appointmentFee === null || appointmentFee === '') {
      return res.status(400).json({ message: 'يجب إدخال قيمة الموعد قبل الإتمام' });
    }
    const fee = Number(appointmentFee);
    if (isNaN(fee) || fee < 0) {
      return res.status(400).json({ message: 'قيمة الموعد غير صالحة' });
    }

    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId.toString());
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) return res.status(404).json({ message: 'الموعد غير موجود' });
    if (!doctorIds.includes(appointment.doctorId.toString())) {
      return res.status(403).json({ message: 'طبيب الموعد ليس في عيادتك' });
    }

    // Total fee = what the accountant entered (which should be doctorFee + clinicFee)
    // The input fee is the TOTAL the patient is PAYING now
    const totalPaying = fee;
    const doctorFeeAmount = appointment.doctorFee || 0;
    const clinicFeeAmount = appointment.clinicFee || appointment.appointmentFee || 0;
    const totalOwed = doctorFeeAmount + clinicFeeAmount;

    // Get clinic percentage for this doctor (applied to doctor's fee portion)
    const doctorEntry = clinic.doctors.find(d => d.doctorId.toString() === appointment.doctorId.toString());
    const clinicPercentage = doctorEntry?.clinicPercentage || 0;
    const clinicShareFromDoctor = doctorFeeAmount > 0 ? Math.round((doctorFeeAmount * clinicPercentage / 100) * 100) / 100 : 0;
    const doctorShareAmount = doctorFeeAmount > 0 ? doctorFeeAmount - clinicShareFromDoctor : 0;

    const remainingDebt = totalOwed - totalPaying;

    appointment.status = 'completed';
    appointment.appointmentFee = clinicFeeAmount;
    // Store financial split info
    appointment.clinicPercentage = clinicPercentage;
    appointment.clinicShare = clinicShareFromDoctor + clinicFeeAmount;
    appointment.doctorShare = doctorShareAmount;

    if (totalPaying > 0) {
      // Patient is paying (full or partial)
      appointment.isPaid = remainingDebt <= 0;
      appointment.paymentAmount = totalPaying;
      appointment.paidAt = new Date();
      appointment.debt = remainingDebt > 0 ? remainingDebt : 0;
      appointment.debtStatus = remainingDebt > 0 ? 'partial' : 'none';
    } else {
      // Just completing, no payment — debt stays
      appointment.isPaid = false;
      appointment.paymentAmount = 0;
      appointment.debt = totalOwed;
      appointment.debtStatus = totalOwed > 0 ? 'full' : 'none';
    }
    await appointment.save();

    // Update clinic owner's financial record (only clinic's share + clear debt)
    const clinicOwnerId = clinic.ownerId;
    try {
      let financial = await Financial.findOne({ doctorId: clinicOwnerId });
      if (!financial) {
        financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
      }

      // Add payment as income transaction (only if patient is paying)
      if (totalPaying > 0) {
        financial.transactions.push({
          amount: totalPaying,
          description: `إتمام موعد - ${clinic.name} (كشفية: ₪${clinicFeeAmount} + رسوم طبيب: ₪${doctorFeeAmount})`,
          date: new Date(),
          patientId: appointment.patient,
          appointmentId: appointment._id,
          paymentMethod: 'Cash',
        });
        financial.totalEarnings = (financial.totalEarnings || 0) + totalPaying;
      }

      // Clear patient's pending debts with payment amount (FIFO)
      const patientId = appointment.patient.toString();
      let feeToDeduct = totalPaying;
      const patientDebts = financial.debts.filter(d => 
        d.patientId?.toString() === patientId && d.status === 'pending'
      );
      patientDebts.sort((a, b) => new Date(a.date) - new Date(b.date));
      for (const debt of patientDebts) {
        if (feeToDeduct <= 0) break;
        if (feeToDeduct >= debt.amount) {
          feeToDeduct -= debt.amount;
          debt.amount = 0;
          debt.status = 'paid';
        } else {
          debt.amount -= feeToDeduct;
          feeToDeduct = 0;
        }
      }
      financial.markModified('debts');
      await financial.save();
    } catch (finErr) {
      console.error('Error updating financial:', finErr);
    }

    // Add ONLY the doctor's share to doctor's own financial record (if doctor != clinic owner)
    if (totalPaying > 0 && doctorShareAmount > 0 && appointment.doctorId.toString() !== clinicOwnerId.toString()) {
      try {
        let doctorFinancial = await Financial.findOne({ doctorId: appointment.doctorId });
        if (!doctorFinancial) {
          doctorFinancial = new Financial({ doctorId: appointment.doctorId, totalEarnings: 0, totalExpenses: 0 });
        }
        doctorFinancial.transactions.push({
          amount: doctorShareAmount,
          description: `حصة الطبيب من كشفية - ${clinic.name} (${100 - clinicPercentage}%)`,
          date: new Date(),
          patientId: appointment.patient,
          appointmentId: appointment._id,
          paymentMethod: 'Cash',
        });
        doctorFinancial.totalEarnings = (doctorFinancial.totalEarnings || 0) + doctorShareAmount;
        await doctorFinancial.save();
      } catch (docFinErr) {
        console.error('Error updating doctor financial:', docFinErr);
      }
    }

    const populatedAppointment = await Appointment.findById(appointment._id)
      .populate('patient', 'fullName email mobileNumber profileImage')
      .populate('doctorId', 'fullName specialty profileImage');

    res.status(200).json({ 
      success: true, 
      message: 'تم إتمام الموعد', 
      appointment: populatedAppointment,
      financialSplit: {
        totalPaying,
        totalOwed,
        remainingDebt: remainingDebt > 0 ? remainingDebt : 0,
        doctorFee: doctorFeeAmount,
        clinicFee: clinicFeeAmount,
        clinicPercentage,
        clinicShare: clinicShareFromDoctor + clinicFeeAmount,
        doctorShare: doctorShareAmount
      }
    });
  } catch (error) {
    console.error('Error completing appointment:', error);
    res.status(500).json({ message: 'فشل في إتمام الموعد', error: error.message });
  }
};

// ==================== LAB REQUEST APPROVAL ====================

// Get pending lab requests for the clinic
exports.getPendingLabRequests = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة' });
    }

    const { status = 'all' } = req.query;
    
    let filter = { clinicId: clinic._id };
    if (status === 'pending' || status === 'pending_approval') {
      filter.approvalStatus = 'pending_approval';
    } else if (status === 'approved') {
      filter.approvalStatus = 'approved';
    } else if (status === 'rejected') {
      filter.approvalStatus = 'rejected';
    }

    const requests = await LabRequest.find(filter)
      .populate('patientId', 'fullName mobileNumber profileImage')
      .populate('doctorId', 'fullName specialty')
      .populate('labId', 'fullName')
      .populate('testIds', 'name type category price')
      .sort({ requestDate: -1 });

    res.status(200).json({ success: true, requests });
  } catch (error) {
    console.error('Error fetching pending lab requests:', error);
    res.status(500).json({ message: 'فشل في جلب طلبات الفحوصات', error: error.message });
  }
};

// Approve a lab request and mark as paid
exports.approveLabRequest = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة' });
    }

    const { requestId } = req.params;
    const { paymentAmount, paymentMethod } = req.body;

    const labRequest = await LabRequest.findById(requestId)
      .populate('testIds', 'name price');

    if (!labRequest) {
      return res.status(404).json({ message: 'طلب الفحص غير موجود' });
    }

    if (labRequest.clinicId?.toString() !== clinic._id.toString()) {
      return res.status(403).json({ message: 'ليس لديك صلاحية على هذا الطلب' });
    }

    const totalCost = labRequest.totalCost || labRequest.testIds.reduce((sum, t) => sum + (t.price || 0), 0);

    // Approve the lab request (do NOT mark as paid yet - patient hasn't paid)
    labRequest.approvalStatus = 'approved';
    labRequest.approvedBy = accountantId;
    labRequest.approvedAt = new Date();
    labRequest.totalCost = totalCost;
    // Only mark as paid if payment was explicitly provided
    if (paymentAmount && Number(paymentAmount) > 0) {
      labRequest.isPaid = true;
      labRequest.paidAmount = Number(paymentAmount);
      labRequest.paidAt = new Date();
      labRequest.paidBy = accountantId;
    }

    await labRequest.save();

    // Add lab test cost as DEBT to the patient in CLINIC OWNER's Financial
    const clinicOwnerId = clinic.ownerId;
    try {
      let financial = await Financial.findOne({ doctorId: clinicOwnerId });
      if (!financial) {
        financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
      }

      const testNames = labRequest.testIds.map(t => t.name).join(', ');
      financial.debts.push({
        patientId: labRequest.patientId,
        amount: totalCost,
        description: `فحوصات مخبرية (${testNames})`,
        date: new Date(),
        status: 'pending'
      });
      financial.markModified('debts');

      // If payment was provided, also record the income and clear the debt
      if (paymentAmount && Number(paymentAmount) > 0) {
        const paid = Number(paymentAmount);
        financial.transactions.push({
          amount: paid,
          description: `دفع فحوصات مخبرية (${testNames})`,
          date: new Date(),
          patientId: labRequest.patientId,
          paymentMethod: paymentMethod || 'Cash'
        });
        financial.totalEarnings = (financial.totalEarnings || 0) + paid;

        // Clear the debt we just added if paid
        const newDebt = financial.debts[financial.debts.length - 1];
        if (paid >= totalCost) {
          newDebt.amount = 0;
          newDebt.status = 'paid';
        } else {
          newDebt.amount = totalCost - paid;
        }
        financial.markModified('debts');
      }

      await financial.save();
    } catch (finErr) {
      console.error('Error updating financial:', finErr);
    }

    const populated = await LabRequest.findById(requestId)
      .populate('patientId', 'fullName mobileNumber')
      .populate('doctorId', 'fullName specialty')
      .populate('testIds', 'name price');

    res.status(200).json({ success: true, message: 'تم الموافقة على الطلب وتسجيل الدفع', labRequest: populated });
  } catch (error) {
    console.error('Error approving lab request:', error);
    res.status(500).json({ message: 'فشل في الموافقة على الطلب', error: error.message });
  }
};

// Reject a lab request
exports.rejectLabRequest = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة' });
    }

    const { requestId } = req.params;
    const { reason } = req.body;

    const labRequest = await LabRequest.findById(requestId);
    if (!labRequest) {
      return res.status(404).json({ message: 'طلب الفحص غير موجود' });
    }

    if (labRequest.clinicId?.toString() !== clinic._id.toString()) {
      return res.status(403).json({ message: 'ليس لديك صلاحية على هذا الطلب' });
    }

    labRequest.approvalStatus = 'rejected';
    labRequest.rejectionReason = reason || '';
    labRequest.status = 'cancelled';
    await labRequest.save();

    res.status(200).json({ success: true, message: 'تم رفض طلب الفحص' });
  } catch (error) {
    console.error('Error rejecting lab request:', error);
    res.status(500).json({ message: 'فشل في رفض الطلب', error: error.message });
  }
};

// ==================== NEW ENDPOINTS ====================

const Supplier = require('../models/Supplier');

// Get single patient with all fields
exports.getPatientById = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const { patientId } = req.params;
    const patient = await User.findById(patientId).select('-password -resetCode -twoFactorCode -phoneVerificationCode');
    if (!patient) {
      return res.status(404).json({ message: 'المريض غير موجود' });
    }
    res.status(200).json({ success: true, patient });
  } catch (error) {
    console.error('Error fetching patient:', error);
    res.status(500).json({ message: 'فشل في جلب بيانات المريض', error: error.message });
  }
};

// Get all medical records for a patient (sorted newest first, including follow-ups)
exports.getPatientRecords = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const { patientId } = req.params;
    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);

    const records = await MedicalRecord.find({
      patient: patientId,
      doctor: { $in: doctorIds }
    })
      .populate('doctor', 'fullName specialty')
      .populate('patient', 'fullName mobileNumber')
      .populate('parentRecord', 'title date')
      .populate('lastEditedBy', 'fullName')
      .sort({ createdAt: -1 });

    // Mark records as new if created within last 48 hours
    const now = new Date();
    const recordsWithMeta = records.map(r => {
      const rec = r.toObject();
      const hoursSinceCreation = (now - new Date(rec.createdAt)) / (1000 * 60 * 60);
      rec.isNew = hoursSinceCreation <= 48;
      return rec;
    });

    res.status(200).json({ success: true, records: recordsWithMeta });
  } catch (error) {
    console.error('Error fetching patient records:', error);
    res.status(500).json({ message: 'فشل في جلب سجلات المريض', error: error.message });
  }
};

// Update patient info
exports.updatePatient = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const { patientId } = req.params;
    const { fullName, mobileNumber, email, idNumber, birthdate, sex, address, city, country,
      maritalStatus,
      emergencyContactName, emergencyContactRelation, emergencyPhone,
      hasChronicDiseases, chronicDiseasesText,
      hasSurgeries, surgeriesText,
      hasFamilyDiseases, familyDiseasesText,
      hasDrugAllergies, drugAllergiesText,
      hasFoodAllergies, foodAllergiesText,
      height, weight, bloodPressure, heartRate, temperature, bloodSugar,
      smoking, previousDiseases, disabilities
    } = req.body;

    // Verify patient belongs to clinic doctors
    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
    const doctors = await User.find({ _id: { $in: doctorIds } });
    const patientBelongsToClinic = doctors.some(d => (d.patients || []).some(p => p.toString() === patientId));
    if (!patientBelongsToClinic) {
      return res.status(403).json({ message: 'المريض لا ينتمي لهذه العيادة' });
    }

    const updateData = {};
    if (fullName) updateData.fullName = fullName;
    if (mobileNumber) updateData.mobileNumber = mobileNumber;
    if (email !== undefined) updateData.email = email;
    if (idNumber) updateData.idNumber = idNumber;
    if (birthdate) updateData.birthdate = birthdate;
    if (sex) updateData.sex = sex;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (country !== undefined) updateData.country = country;
    if (maritalStatus !== undefined) updateData.maritalStatus = maritalStatus;
    if (emergencyContactName !== undefined) updateData.emergencyContactName = emergencyContactName;
    if (emergencyContactRelation !== undefined) updateData.emergencyContactRelation = emergencyContactRelation;
    if (emergencyPhone !== undefined) updateData.emergencyPhone = emergencyPhone;
    if (hasChronicDiseases !== undefined) updateData.hasChronicDiseases = hasChronicDiseases;
    if (chronicDiseasesText !== undefined) updateData.chronicDiseasesText = chronicDiseasesText;
    if (hasSurgeries !== undefined) updateData.hasSurgeries = hasSurgeries;
    if (surgeriesText !== undefined) updateData.surgeriesText = surgeriesText;
    if (hasFamilyDiseases !== undefined) updateData.hasFamilyDiseases = hasFamilyDiseases;
    if (familyDiseasesText !== undefined) updateData.familyDiseasesText = familyDiseasesText;
    if (hasDrugAllergies !== undefined) updateData.hasDrugAllergies = hasDrugAllergies;
    if (drugAllergiesText !== undefined) updateData.drugAllergiesText = drugAllergiesText;
    if (hasFoodAllergies !== undefined) updateData.hasFoodAllergies = hasFoodAllergies;
    if (foodAllergiesText !== undefined) updateData.foodAllergiesText = foodAllergiesText;
    if (height !== undefined) updateData.height = height ? Number(height) : null;
    if (weight !== undefined) updateData.weight = weight ? Number(weight) : null;
    if (bloodPressure !== undefined) updateData.bloodPressure = bloodPressure;
    if (heartRate !== undefined) updateData.heartRate = heartRate;
    if (temperature !== undefined) updateData.temperature = temperature;
    if (bloodSugar !== undefined) updateData.bloodSugar = bloodSugar;
    if (smoking !== undefined) updateData.smoking = smoking;
    if (previousDiseases !== undefined) updateData.previousDiseases = previousDiseases;
    if (disabilities !== undefined) updateData.disabilities = disabilities;

    const patient = await User.findByIdAndUpdate(patientId, updateData, { new: true })
      .select('fullName mobileNumber email idNumber birthdate sex address city country maritalStatus emergencyContactName emergencyContactRelation emergencyPhone hasChronicDiseases chronicDiseasesText hasSurgeries surgeriesText hasFamilyDiseases familyDiseasesText hasDrugAllergies drugAllergiesText hasFoodAllergies foodAllergiesText height weight bloodPressure heartRate temperature bloodSugar smoking previousDiseases disabilities');

    if (!patient) {
      return res.status(404).json({ message: 'المريض غير موجود' });
    }

    res.status(200).json({ success: true, message: 'تم تحديث بيانات المريض بنجاح', patient });
  } catch (error) {
    console.error('Error updating patient:', error);
    res.status(500).json({ message: 'فشل في تحديث بيانات المريض', error: error.message });
  }
};

// Insert payment for a patient (add to clinic's financial transactions)
exports.insertPayment = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const { patientId, amount, description, paymentMethod, date } = req.body;
    if (!patientId || !amount) {
      return res.status(400).json({ message: 'المريض والمبلغ مطلوبان' });
    }

    const clinicOwnerId = clinic.ownerId;
    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
    }

    // Record payment as income transaction
    financial.transactions.push({
      amount: Number(amount),
      description: description || 'دفعة من مريض',
      date: date ? new Date(date) : new Date(),
      patientId,
      paymentMethod: paymentMethod || 'Cash'
    });
    financial.totalEarnings += Number(amount);

    // Reduce patient's pending debts with this payment
    // First clear debts from clinic owner's record
    let remainingPayment = Number(amount);
    const patientDebts = financial.debts.filter(d => 
      d.patientId?.toString() === patientId && d.status === 'pending'
    );
    // Sort debts oldest first
    patientDebts.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Track how much was paid per doctor from debt clearing (for revenue split)
    const doctorDebtPayments = {}; // { doctorId: totalPaidFromDebts }

    for (const debt of patientDebts) {
      if (remainingPayment <= 0) break;
      const paidForThisDebt = Math.min(remainingPayment, debt.amount);
      // Save original amount before modifying
      if (!debt.originalAmount) {
        debt.originalAmount = debt.amount;
      }
      if (remainingPayment >= debt.amount) {
        remainingPayment -= debt.amount;
        debt.amount = 0;
        debt.status = 'paid';
        debt.paidAt = new Date();
      } else {
        debt.amount -= remainingPayment;
        remainingPayment = 0;
      }
      // Track payment per doctor for revenue split
      if (debt.doctorId && debt.doctorId.toString() !== clinicOwnerId.toString()) {
        const docId = debt.doctorId.toString();
        doctorDebtPayments[docId] = (doctorDebtPayments[docId] || 0) + paidForThisDebt;
      }
    }

    financial.markModified('debts');
    await financial.save();

    // If still remaining payment, also clear debts from individual doctors' Financial records
    if (remainingPayment > 0) {
      const doctorIdsForDebts = clinic.doctors?.filter(d => d.status === 'active').map(d => d.doctorId) || [];
      const doctorFinancials = await Financial.find({ 
        doctorId: { $in: doctorIdsForDebts },
        'debts.patientId': patientId,
        'debts.status': 'pending'
      });
      
      for (const docFin of doctorFinancials) {
        if (remainingPayment <= 0) break;
        const docDebts = docFin.debts.filter(d =>
          d.patientId?.toString() === patientId && d.status === 'pending'
        );
        docDebts.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        for (const debt of docDebts) {
          if (remainingPayment <= 0) break;
          const paidForThisDebt = Math.min(remainingPayment, debt.amount);
          // Save original amount before modifying
          if (!debt.originalAmount) {
            debt.originalAmount = debt.amount;
          }
          if (remainingPayment >= debt.amount) {
            remainingPayment -= debt.amount;
            debt.amount = 0;
            debt.status = 'paid';
            debt.paidAt = new Date();
          } else {
            debt.amount -= remainingPayment;
            remainingPayment = 0;
          }
          // Track payment for this doctor (old debts on doctor's own Financial)
          // The doctor is docFin.doctorId
          const docIdStr = docFin.doctorId.toString();
          if (docIdStr !== clinicOwnerId.toString()) {
            doctorDebtPayments[docIdStr] = (doctorDebtPayments[docIdStr] || 0) + paidForThisDebt;
          }
        }
        docFin.markModified('debts');
        await docFin.save();
      }
    }

    // Mark unpaid appointments as paid for this patient
    const doctorIds = clinic.doctors?.filter(d => d.status === 'active').map(d => d.doctorId) || [];
    // Also include clinic owner in case they are a doctor
    if (!doctorIds.some(id => id.toString() === clinicOwnerId.toString())) {
      doctorIds.push(clinicOwnerId);
    }
    const unpaidAppointments = await Appointment.find({
      patient: patientId,
      doctorId: { $in: doctorIds },
      isPaid: { $ne: true },
      status: { $in: ['confirmed', 'completed'] }
    }).sort({ appointmentDateTime: 1 });

    let paymentPool = Number(amount);
    const paidAppointmentIds = [];
    for (const apt of unpaidAppointments) {
      if (paymentPool <= 0) break;
      // Total fee is doctorFee + clinicFee (or appointmentFee for backward compat)
      const totalAptFee = (apt.doctorFee || 0) + (apt.clinicFee || apt.appointmentFee || 0);
      const alreadyPaid = apt.paymentAmount || 0;
      const remaining = totalAptFee - alreadyPaid;
      if (remaining <= 0) {
        // Already covered, just mark as paid
        apt.isPaid = true;
        apt.paymentAmount = totalAptFee;
        apt.paidAt = new Date();
        apt.debt = 0;
        apt.debtStatus = 'none';
        await apt.save();
        paidAppointmentIds.push(apt._id);
        continue;
      }
      if (paymentPool >= remaining) {
        paymentPool -= remaining;
        apt.isPaid = true;
        apt.paymentAmount = totalAptFee;
        apt.paidAt = new Date();
        apt.debt = 0;
        apt.debtStatus = 'none';
        await apt.save();
        paidAppointmentIds.push(apt._id);
      } else {
        apt.paymentAmount = alreadyPaid + paymentPool;
        apt.debt = totalAptFee - apt.paymentAmount;
        apt.debtStatus = 'partial';
        await apt.save();
        paymentPool = 0;
      }
    }

    // Add income to each doctor's own financial for paid appointments (if doctor != clinic owner)
    // Only add if the appointment was NOT already completed with payment (avoid double-counting)
    for (const apt of unpaidAppointments) {
      if (apt.isPaid && apt.doctorId.toString() !== clinicOwnerId.toString()) {
        try {
          const doctorFeeAmount = apt.doctorFee || 0;
          if (doctorFeeAmount > 0) {
            // Check if doctor's share was already recorded for this appointment
            let doctorFinancial = await Financial.findOne({ doctorId: apt.doctorId });
            if (!doctorFinancial) {
              doctorFinancial = new Financial({ doctorId: apt.doctorId, totalEarnings: 0, totalExpenses: 0 });
            }
            const alreadyRecorded = doctorFinancial.transactions.some(t => 
              t.appointmentId?.toString() === apt._id.toString()
            );
            if (!alreadyRecorded) {
              // Apply clinic percentage
              const doctorEntry = clinic.doctors.find(d => d.doctorId.toString() === apt.doctorId.toString());
              const clinicPercentage = doctorEntry?.clinicPercentage || 0;
              const doctorShare = doctorFeeAmount - Math.round((doctorFeeAmount * clinicPercentage / 100) * 100) / 100;
              if (doctorShare > 0) {
                doctorFinancial.transactions.push({
                  amount: doctorShare,
                  description: `حصة الطبيب من دفعة مريض - ${clinic.name}`,
                  date: new Date(),
                  patientId: apt.patient,
                  appointmentId: apt._id,
                  paymentMethod: paymentMethod || 'Cash',
                });
                doctorFinancial.totalEarnings = (doctorFinancial.totalEarnings || 0) + doctorShare;
                await doctorFinancial.save();
              }
            }
          }
        } catch (docFinErr) {
          console.error('Error updating doctor financial for apt:', docFinErr);
        }
      }
    }

    // Split debt payments to doctors based on clinic percentage
    // This handles debts created from medical records (treatment costs) which have doctorId
    for (const [docId, paidAmount] of Object.entries(doctorDebtPayments)) {
      try {
        const doctorEntry = clinic.doctors.find(d => d.doctorId.toString() === docId);
        const clinicPercentage = doctorEntry?.clinicPercentage || 0;
        const doctorShare = Math.round((paidAmount * (100 - clinicPercentage) / 100) * 100) / 100;
        
        if (doctorShare > 0) {
          let doctorFinancial = await Financial.findOne({ doctorId: docId });
          if (!doctorFinancial) {
            doctorFinancial = new Financial({ doctorId: docId, totalEarnings: 0, totalExpenses: 0 });
          }
          
          doctorFinancial.transactions.push({
            amount: doctorShare,
            description: `حصة الطبيب من سداد دين مريض - ${clinic.name} (${100 - clinicPercentage}%)`,
            date: new Date(),
            patientId,
            paymentMethod: paymentMethod || 'Cash'
          });
          doctorFinancial.totalEarnings = (doctorFinancial.totalEarnings || 0) + doctorShare;
          
          // Clear matching debts on doctor's own financial (backward compat)
          const docDebts = (doctorFinancial.debts || []).filter(d =>
            d.patientId?.toString() === patientId && d.status === 'pending'
          );
          let rem = paidAmount;
          for (const dd of docDebts) {
            if (rem <= 0) break;
            if (!dd.originalAmount) {
              dd.originalAmount = dd.amount;
            }
            if (rem >= dd.amount) {
              rem -= dd.amount;
              dd.amount = 0;
              dd.status = 'paid';
              dd.paidAt = new Date();
            } else {
              dd.amount -= rem;
              rem = 0;
            }
          }
          doctorFinancial.markModified('debts');
          await doctorFinancial.save();
          console.log(`✅ Doctor ${docId} share ${doctorShare} from debt payment (clinic ${clinicPercentage}%)`);
        }
      } catch (docErr) {
        console.error('Error splitting debt payment to doctor:', docErr);
      }
    }

    // Calculate remaining total debt for patient
    const remainingDebt = financial.debts
      .filter(d => d.patientId?.toString() === patientId && d.status === 'pending')
      .reduce((sum, d) => sum + d.amount, 0);

    // Get patient info for receipt
    const patient = await User.findById(patientId).select('fullName mobileNumber');

    res.status(200).json({
      success: true,
      message: 'تم تسجيل الدفع بنجاح',
      remainingDebt,
      paidAppointments: paidAppointmentIds.length,
      receipt: {
        patientName: patient?.fullName || 'غير معروف',
        patientPhone: patient?.mobileNumber || '',
        clinicName: clinic.name || 'العيادة',
        amount: Number(amount),
        paymentMethod: paymentMethod || 'Cash',
        description: description || 'دفعة من مريض',
        remainingDebt,
        date: new Date().toISOString(),
        receiptNo: Date.now().toString(36).toUpperCase()
      }
    });
  } catch (error) {
    console.error('Error inserting payment:', error);
    res.status(500).json({ message: 'فشل في تسجيل الدفع', error: error.message });
  }
};

// Get patients with debt info
exports.getPatientsWithDebt = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const clinicOwnerId = clinic.ownerId;
    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);

    // Get patients
    const doctors = await User.find({ _id: { $in: doctorIds } })
      .populate('patients', 'fullName email mobileNumber profileImage city address birthdate sex idNumber createdAt');

    const patientsMap = new Map();
    for (const doctor of doctors) {
      for (const patient of (doctor.patients || [])) {
        const patientId = patient._id.toString();
        if (!patientsMap.has(patientId)) {
          patientsMap.set(patientId, {
            ...patient.toObject(),
            doctors: []
          });
        }
        patientsMap.get(patientId).doctors.push({
          _id: doctor._id,
          fullName: doctor.fullName,
          specialty: doctor.specialty
        });
      }
    }

    // Get financial data for debts from clinic owner AND all clinic doctors
    const allFinancialIds = [clinicOwnerId, ...doctorIds];
    const allFinancials = await Financial.find({ doctorId: { $in: allFinancialIds } });
    
    // Merge all debts from all financial records (clinic owner + all doctors)
    let debts = [];
    for (const fin of allFinancials) {
      if (fin.debts && fin.debts.length > 0) {
        debts = debts.concat(fin.debts);
      }
    }

    // Also get appointment-based debts from all clinic doctors
    const allDoctorIds = [...doctorIds];
    if (!allDoctorIds.some(id => id.toString() === clinicOwnerId.toString())) {
      allDoctorIds.push(clinicOwnerId);
    }
    const appointmentDebts = await Appointment.aggregate([
      { $match: { doctorId: { $in: allDoctorIds }, debt: { $gt: 0 } } },
      { $group: { _id: '$patient', totalAppointmentDebt: { $sum: '$debt' } } }
    ]);
    const appointmentDebtMap = {};
    appointmentDebts.forEach(d => { appointmentDebtMap[d._id.toString()] = d.totalAppointmentDebt; });

    // Map debts to patients (combine Financial.debts + Appointment.debt, avoid double-count)
    const patients = Array.from(patientsMap.values()).map(patient => {
      const pid = patient._id.toString();
      const patientDebts = debts.filter(d => {
        const debtPatientId = d.patientId?.toString();
        return debtPatientId === pid && d.status !== 'paid';
      });
      const financialDebtTotal = patientDebts.reduce((sum, d) => sum + (d.amount || 0), 0);
      // Use whichever is higher to avoid double-counting
      // (appointment.debt and Financial.debts should be in sync, but use max as safety)
      const appointmentDebtTotal = appointmentDebtMap[pid] || 0;
      const totalDebt = Math.max(financialDebtTotal, appointmentDebtTotal);
      return { ...patient, totalDebt, debts: patientDebts };
    });

    // Sort: patients with debt first, then by newest (createdAt)
    patients.sort((a, b) => {
      if (b.totalDebt !== a.totalDebt) return b.totalDebt - a.totalDebt;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    res.status(200).json({ success: true, patients, totalCount: patients.length });
  } catch (error) {
    console.error('Error fetching patients with debt:', error);
    res.status(500).json({ message: 'فشل في جلب قائمة المرضى', error: error.message });
  }
};

// Get financial data (expenses, debts, income) for clinic
exports.getFinancialData = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const clinicOwnerId = clinic.ownerId;
    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);

    // Get Financial model data (expenses, debts, manual transactions) from clinic owner
    let financial = await Financial.findOne({ doctorId: clinicOwnerId })
      .populate('expenses.employeeId', 'fullName')
      .populate('expenses.supplierId', 'name')
      .populate('debts.patientId', 'fullName mobileNumber');

    if (!financial) {
      financial = { transactions: [], expenses: [], debts: [], totalEarnings: 0, totalExpenses: 0 };
    }

    // Also get debts from all clinic doctors' Financial records
    const doctorFinancials = await Financial.find({ 
      doctorId: { $in: doctorIds },
    }).populate('debts.patientId', 'fullName mobileNumber');
    
    // Merge debts from doctors into the main financial object
    const financialObj = financial.toObject ? financial.toObject() : { ...financial };
    for (const docFin of doctorFinancials) {
      if (docFin.doctorId.toString() === clinicOwnerId.toString()) continue; // skip owner, already included
      const docDebts = (docFin.debts || []).filter(d => d.status === 'pending');
      if (docDebts.length > 0) {
        financialObj.debts = [...(financialObj.debts || []), ...docDebts.map(d => d.toObject ? d.toObject() : d)];
      }
    }

    // Calculate actual income from paid appointments (current month) across ALL clinic doctors
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const paidAppointments = await Appointment.find({
      doctorId: { $in: doctorIds },
      isPaid: true,
      $or: [
        { paidAt: { $gte: startOfMonth, $lte: endOfMonth } },
        { paidAt: { $exists: false }, updatedAt: { $gte: startOfMonth, $lte: endOfMonth }, isPaid: true },
        { paidAt: null, updatedAt: { $gte: startOfMonth, $lte: endOfMonth }, isPaid: true }
      ]
    });

    const appointmentIncome = paidAppointments.reduce((sum, apt) => sum + (apt.paymentAmount || apt.appointmentFee || 0), 0);

    // Lab test income for current month
    const labPayments = await LabRequest.find({
      doctorId: { $in: doctorIds },
      isPaid: true,
      paidAt: { $gte: startOfMonth, $lte: endOfMonth }
    });
    const labIncome = labPayments.reduce((sum, lab) => sum + (lab.paidAmount || lab.totalCost || 0), 0);

    // Current month expenses from Financial model
    const monthExpenses = (financial.expenses || []).filter(exp => {
      const expDate = new Date(exp.date || exp.createdAt);
      return expDate >= startOfMonth && expDate <= endOfMonth;
    });
    const monthExpensesTotal = monthExpenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);

    // Also add non-appointment Financial.transactions income (debt payments, manual payments)
    // These are NOT counted in the Appointment/Lab queries above
    let financialTransactionIncome = 0;
    const ownerTransactions = financial.transactions || [];
    for (const txn of ownerTransactions) {
      // Skip appointment-linked transactions (already counted from Appointment model)
      if (txn.appointmentId) continue;
      const txnDate = new Date(txn.date);
      if (txnDate >= startOfMonth && txnDate <= endOfMonth) {
        financialTransactionIncome += txn.amount || 0;
      }
    }

    const totalMonthlyIncome = appointmentIncome + labIncome + financialTransactionIncome;

    // Build response - augment financial with computed income and merged debts
    const financialData = financial.toObject ? financial.toObject() : { ...financial };
    financialData.debts = financialObj.debts || []; // Use merged debts from all doctors
    financialData.totalEarnings = totalMonthlyIncome;
    financialData.totalExpenses = monthExpensesTotal;
    financialData.appointmentIncome = appointmentIncome;
    financialData.labIncome = labIncome;
    financialData.paymentIncome = financialTransactionIncome;
    financialData.monthLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    res.status(200).json({ success: true, financial: financialData });
  } catch (error) {
    console.error('Error fetching financial data:', error);
    res.status(500).json({ message: 'فشل في جلب البيانات المالية', error: error.message });
  }
};

// Add expense
exports.addExpense = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const clinicOwnerId = clinic.ownerId;
    const { amount, description, category, date, employeeId, supplierId, selectedProducts } = req.body;

    if (!amount || !description) {
      return res.status(400).json({ message: 'المبلغ والوصف مطلوبان' });
    }

    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
    }

    const expense = {
      amount: Number(amount),
      description,
      category: category || 'General',
      date: date ? new Date(date) : new Date(),
    };
    if (employeeId) expense.employeeId = employeeId;
    if (supplierId) expense.supplierId = supplierId;
    if (selectedProducts && selectedProducts.length > 0) expense.selectedProducts = selectedProducts;

    financial.expenses.push(expense);
    financial.totalExpenses += Number(amount);
    await financial.save();

    res.status(200).json({ success: true, message: 'تم إضافة المصروف بنجاح' });
  } catch (error) {
    console.error('Error adding expense:', error);
    res.status(500).json({ message: 'فشل في إضافة المصروف', error: error.message });
  }
};

// Update expense
exports.updateExpense = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const clinicOwnerId = clinic.ownerId;
    const { expenseId } = req.params;
    const { amount, description, category, date, employeeId, supplierId, selectedProducts } = req.body;

    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) return res.status(404).json({ message: 'لم يتم العثور على بيانات مالية' });

    const expense = financial.expenses.id(expenseId);
    if (!expense) return res.status(404).json({ message: 'المصروف غير موجود' });

    const oldAmount = expense.amount;
    if (amount !== undefined) expense.amount = Number(amount);
    if (description !== undefined) expense.description = description;
    if (category !== undefined) expense.category = category;
    if (date !== undefined) expense.date = new Date(date);
    if (employeeId !== undefined) expense.employeeId = employeeId || undefined;
    if (supplierId !== undefined) expense.supplierId = supplierId || undefined;
    if (selectedProducts !== undefined) expense.selectedProducts = selectedProducts;

    financial.totalExpenses = financial.totalExpenses - oldAmount + expense.amount;
    await financial.save();

    res.status(200).json({ success: true, message: 'تم تحديث المصروف بنجاح' });
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ message: 'فشل في تحديث المصروف', error: error.message });
  }
};

// Delete expense
exports.deleteExpense = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const clinicOwnerId = clinic.ownerId;
    const { expenseId } = req.params;

    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) return res.status(404).json({ message: 'لم يتم العثور على بيانات مالية' });

    const expense = financial.expenses.id(expenseId);
    if (!expense) return res.status(404).json({ message: 'المصروف غير موجود' });

    financial.totalExpenses -= expense.amount;
    financial.expenses.pull(expenseId);
    await financial.save();

    res.status(200).json({ success: true, message: 'تم حذف المصروف بنجاح' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ message: 'فشل في حذف المصروف', error: error.message });
  }
};

// Add debt
exports.addDebt = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const clinicOwnerId = clinic.ownerId;
    const { patientId, amount, description, date } = req.body;

    if (!patientId || !amount) {
      return res.status(400).json({ message: 'المريض والمبلغ مطلوبان' });
    }

    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
    }

    financial.debts.push({
      patientId,
      amount: Number(amount),
      description: description || 'دين',
      date: date ? new Date(date) : new Date(),
      status: 'pending'
    });
    await financial.save();

    res.status(200).json({ success: true, message: 'تم إضافة الدين بنجاح' });
  } catch (error) {
    console.error('Error adding debt:', error);
    res.status(500).json({ message: 'فشل في إضافة الدين', error: error.message });
  }
};

// Pay debt
exports.payDebt = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const clinicOwnerId = clinic.ownerId;
    const { debtId } = req.params;
    const { amount, paymentMethod } = req.body;

    // Also search in all doctors' Financial records (for old debts stored on doctor's record)
    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) return res.status(404).json({ message: 'لم يتم العثور على بيانات مالية' });

    let debt = financial.debts.id(debtId);
    let debtOwnerFinancial = financial;
    
    // If not found in clinic owner's financial, search in doctors' financials
    if (!debt) {
      const doctorIds = clinic.doctors?.filter(d => d.status === 'active').map(d => d.doctorId) || [];
      for (const docId of doctorIds) {
        const docFin = await Financial.findOne({ doctorId: docId });
        if (docFin) {
          const found = docFin.debts.id(debtId);
          if (found) {
            debt = found;
            debtOwnerFinancial = docFin;
            break;
          }
        }
      }
    }
    
    if (!debt) return res.status(404).json({ message: 'الدين غير موجود' });

    const paymentAmount = amount ? Number(amount) : debt.amount;
    // Determine which doctor created this debt:
    // 1. From debt.doctorId (new debts have this)
    // 2. From the Financial record's doctorId if debt was found on a doctor's record (old debts)
    let debtDoctorId = debt.doctorId;
    if (!debtDoctorId && debtOwnerFinancial.doctorId && debtOwnerFinancial.doctorId.toString() !== clinicOwnerId.toString()) {
      debtDoctorId = debtOwnerFinancial.doctorId;
    }

    // Save original amount before modifying (for tracking purposes)
    if (!debt.originalAmount) {
      debt.originalAmount = debt.amount;
    }

    if (paymentAmount >= debt.amount) {
      debt.status = 'paid';
      debt.amount = 0;
      debt.paidAt = new Date();
    } else {
      debt.amount -= paymentAmount;
    }
    
    debtOwnerFinancial.markModified('debts');
    await debtOwnerFinancial.save();

    // Add payment as a transaction on clinic owner's Financial
    financial.transactions.push({
      amount: paymentAmount,
      description: `دفع دين - ${debt.description || ''}`,
      date: new Date(),
      patientId: debt.patientId,
      paymentMethod: paymentMethod || 'Cash'
    });
    financial.totalEarnings += paymentAmount;
    if (debtOwnerFinancial._id.toString() !== financial._id.toString()) {
      await financial.save();
    } else {
      // Already saved above with debt changes, save again with transaction
      await financial.save();
    }

    // Split payment to doctor if the debt was created by a doctor (not the clinic owner)
    if (debtDoctorId && debtDoctorId.toString() !== clinicOwnerId.toString()) {
      try {
        const doctorEntry = clinic.doctors.find(d => d.doctorId.toString() === debtDoctorId.toString());
        const clinicPercentage = doctorEntry?.clinicPercentage || 0;
        const doctorShare = Math.round((paymentAmount * (100 - clinicPercentage) / 100) * 100) / 100;
        
        if (doctorShare > 0) {
          let doctorFinancial = await Financial.findOne({ doctorId: debtDoctorId });
          if (!doctorFinancial) {
            doctorFinancial = new Financial({ doctorId: debtDoctorId, totalEarnings: 0, totalExpenses: 0 });
          }
          
          // Add doctor's share as income
          doctorFinancial.transactions.push({
            amount: doctorShare,
            description: `حصة الطبيب من سداد دين - ${debt.description || ''}`,
            date: new Date(),
            patientId: debt.patientId,
            paymentMethod: paymentMethod || 'Cash'
          });
          doctorFinancial.totalEarnings = (doctorFinancial.totalEarnings || 0) + doctorShare;
          
          // Also mark matching debts as paid on doctor's own Financial (backward compat)
          const doctorDebts = (doctorFinancial.debts || []).filter(d =>
            d.patientId?.toString() === debt.patientId?.toString() && d.status === 'pending'
          );
          let remaining = paymentAmount;
          for (const dd of doctorDebts) {
            if (remaining <= 0) break;
            if (!dd.originalAmount) {
              dd.originalAmount = dd.amount;
            }
            if (remaining >= dd.amount) {
              remaining -= dd.amount;
              dd.amount = 0;
              dd.status = 'paid';
              dd.paidAt = new Date();
            } else {
              dd.amount -= remaining;
              remaining = 0;
            }
          }
          doctorFinancial.markModified('debts');
          await doctorFinancial.save();
          console.log(`✅ Doctor share ${doctorShare} added to doctor ${debtDoctorId} (clinic takes ${clinicPercentage}%)`);
        }
      } catch (docErr) {
        console.error('Error updating doctor financial on debt payment:', docErr);
      }
    }

    res.status(200).json({ success: true, message: 'تم تسجيل الدفع بنجاح' });
  } catch (error) {
    console.error('Error paying debt:', error);
    res.status(500).json({ message: 'فشل في تسجيل الدفع', error: error.message });
  }
};

// Get suppliers for accountant's clinic
exports.getSuppliers = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const clinicOwnerId = clinic.ownerId;
    const suppliers = await Supplier.find({ createdBy: clinicOwnerId, isActive: true }).sort({ createdAt: -1 });

    res.status(200).json({ success: true, suppliers });
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({ message: 'فشل في جلب الموردين', error: error.message });
  }
};

// Add supplier
exports.addSupplier = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const clinicOwnerId = clinic.ownerId;
    const { name, description, contactPerson, email, phone, address, products, notes } = req.body;

    if (!name || !description) {
      return res.status(400).json({ message: 'الاسم والوصف مطلوبان' });
    }

    const supplier = new Supplier({
      name,
      description,
      contactPerson,
      email,
      phone,
      address,
      products: products || [],
      notes,
      createdBy: clinicOwnerId
    });

    await supplier.save();

    res.status(201).json({ success: true, message: 'تم إضافة المورد بنجاح', supplier });
  } catch (error) {
    console.error('Error adding supplier:', error);
    res.status(500).json({ message: 'فشل في إضافة المورد', error: error.message });
  }
};

// Update supplier
exports.updateSupplier = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const clinicOwnerId = clinic.ownerId;
    const { supplierId } = req.params;

    const supplier = await Supplier.findOne({ _id: supplierId, createdBy: clinicOwnerId });
    if (!supplier) {
      return res.status(404).json({ message: 'المورد غير موجود' });
    }

    const updateData = req.body;
    const updated = await Supplier.findByIdAndUpdate(supplierId, updateData, { new: true });

    res.status(200).json({ success: true, message: 'تم تحديث المورد بنجاح', supplier: updated });
  } catch (error) {
    console.error('Error updating supplier:', error);
    res.status(500).json({ message: 'فشل في تحديث المورد', error: error.message });
  }
};

// Delete supplier
exports.deleteSupplier = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const clinicOwnerId = clinic.ownerId;
    const { supplierId } = req.params;

    const supplier = await Supplier.findOne({ _id: supplierId, createdBy: clinicOwnerId });
    if (!supplier) {
      return res.status(404).json({ message: 'المورد غير موجود' });
    }

    supplier.isActive = false;
    await supplier.save();

    res.status(200).json({ success: true, message: 'تم حذف المورد بنجاح' });
  } catch (error) {
    console.error('Error deleting supplier:', error);
    res.status(500).json({ message: 'فشل في حذف المورد', error: error.message });
  }
};

// Get clinic staff (doctors + staff) for salary recipients
exports.getStaffList = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
    const doctors = await User.find({ _id: { $in: doctorIds } }, 'fullName specialty');

    const staffIds = (clinic.staff || []).filter(s => s.status === 'active').map(s => s.userId);
    const staffUsers = await User.find({ _id: { $in: staffIds } }, 'fullName');
    const staffMap = {};
    staffUsers.forEach(s => { staffMap[s._id.toString()] = s; });

    const staffList = (clinic.staff || []).filter(s => s.status === 'active').map(s => {
      const user = staffMap[s.userId.toString()];
      return {
        _id: s.userId,
        fullName: user?.fullName || 'Unknown',
        role: s.role,
        type: 'staff'
      };
    });

    const doctorList = doctors.map(d => ({
      _id: d._id,
      fullName: d.fullName,
      specialty: d.specialty,
      role: 'Doctor',
      type: 'doctor'
    }));

    res.status(200).json({ success: true, staff: [...doctorList, ...staffList] });
  } catch (error) {
    console.error('Error fetching staff list:', error);
    res.status(500).json({ message: 'فشل في جلب قائمة الموظفين', error: error.message });
  }
};

// Create invoice for patient (multiple line items)
exports.createInvoice = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const clinicOwnerId = clinic.ownerId;
    const { patientId, items, paymentMethod, notes } = req.body;

    if (!patientId || !items || items.length === 0) {
      return res.status(400).json({ message: 'المريض وبنود الفاتورة مطلوبة' });
    }

    const totalAmount = items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);

    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
    }

    // Generate invoice ID
    const invoiceId = new Date().getTime().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();

    // Add total as debt to patient
    const itemDescriptions = items.map(item => item.description).filter(Boolean).join(', ');
    financial.debts.push({
      patientId,
      amount: totalAmount,
      description: 'فاتورة #' + invoiceId + ' - ' + (itemDescriptions || 'خدمات'),
      date: new Date(),
      status: 'pending'
    });

    await financial.save();

    // Get patient info for response
    const patient = await User.findById(patientId, 'fullName mobileNumber idNumber');

    res.status(200).json({
      success: true,
      message: 'تم إنشاء الفاتورة بنجاح',
      invoice: {
        invoiceId,
        patient: patient ? { fullName: patient.fullName, mobileNumber: patient.mobileNumber, idNumber: patient.idNumber } : null,
        items,
        totalAmount,
        paymentMethod: paymentMethod || 'Cash',
        notes: notes || '',
        date: new Date(),
        clinicName: clinic.name || ''
      }
    });
  } catch (error) {
    console.error('Error creating invoice:', error);
    res.status(500).json({ message: 'فشل في إنشاء الفاتورة', error: error.message });
  }
};

// ==================== CLINIC PERCENTAGE & DOCTOR ACCOUNTS ====================

// Set clinic percentage for a doctor
exports.setDoctorClinicPercentage = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const { doctorId } = req.params;
    const { clinicPercentage } = req.body;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) return res.status(404).json({ message: 'لم يتم العثور على عيادة' });

    if (clinicPercentage === undefined || clinicPercentage === null) {
      return res.status(400).json({ message: 'يجب تحديد نسبة العيادة' });
    }
    const percentage = Number(clinicPercentage);
    if (isNaN(percentage) || percentage < 0 || percentage > 100) {
      return res.status(400).json({ message: 'النسبة يجب أن تكون بين 0 و 100' });
    }

    const doctorEntry = clinic.doctors.find(d => d.doctorId.toString() === doctorId && d.status === 'active');
    if (!doctorEntry) {
      return res.status(404).json({ message: 'الطبيب غير موجود في العيادة' });
    }

    doctorEntry.clinicPercentage = percentage;
    clinic.markModified('doctors');
    await clinic.save();

    const doctor = await User.findById(doctorId, 'fullName specialty');

    res.status(200).json({
      success: true,
      message: `تم تحديد نسبة العيادة ${percentage}% للطبيب ${doctor?.fullName || ''}`,
      doctor: {
        _id: doctorId,
        fullName: doctor?.fullName,
        specialty: doctor?.specialty,
        clinicPercentage: percentage
      }
    });
  } catch (error) {
    console.error('Error setting clinic percentage:', error);
    res.status(500).json({ message: 'فشل في تحديد نسبة العيادة', error: error.message });
  }
};

// Get doctors with their clinic percentages
exports.getDoctorsWithPercentages = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) return res.status(404).json({ message: 'لم يتم العثور على عيادة' });

    const activeDoctors = clinic.doctors.filter(d => d.status === 'active');
    const doctorIds = activeDoctors.map(d => d.doctorId);
    const doctors = await User.find({ _id: { $in: doctorIds } }, 'fullName specialty profileImage consultationFee');

    const doctorsWithPercentages = doctors.map(doc => {
      const entry = activeDoctors.find(d => d.doctorId.toString() === doc._id.toString());
      return {
        _id: doc._id,
        fullName: doc.fullName,
        specialty: doc.specialty,
        profileImage: doc.profileImage,
        consultationFee: doc.consultationFee,
        clinicPercentage: entry?.clinicPercentage || 0,
        doctorPercentage: 100 - (entry?.clinicPercentage || 0)
      };
    });

    res.status(200).json({ success: true, doctors: doctorsWithPercentages });
  } catch (error) {
    console.error('Error fetching doctors with percentages:', error);
    res.status(500).json({ message: 'فشل في جلب بيانات الأطباء', error: error.message });
  }
};

// Get doctor accounts report (how much each doctor is owed)
exports.getDoctorAccountsReport = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) return res.status(404).json({ message: 'لم يتم العثور على عيادة' });

    const { month, year, doctorId: filterDoctorId } = req.query;
    const now = new Date();
    const filterYear = year ? parseInt(year) : now.getFullYear();
    const filterMonth = month ? parseInt(month) : now.getMonth() + 1;
    const startDate = new Date(filterYear, filterMonth - 1, 1);
    const endDate = new Date(filterYear, filterMonth, 0, 23, 59, 59);

    let activeDoctors = clinic.doctors.filter(d => d.status === 'active');
    if (filterDoctorId) {
      activeDoctors = activeDoctors.filter(d => d.doctorId.toString() === filterDoctorId);
    }
    const doctorIds = activeDoctors.map(d => d.doctorId);
    const doctors = await User.find({ _id: { $in: doctorIds } }, 'fullName specialty profileImage consultationFee');

    const report = [];

    for (const doc of doctors) {
      const entry = activeDoctors.find(d => d.doctorId.toString() === doc._id.toString());
      const clinicPercentage = entry?.clinicPercentage || 0;

      // Get completed appointments for this doctor in the period
      const completedAppointments = await Appointment.find({
        doctorId: doc._id,
        status: 'completed',
        isPaid: true,
        $or: [
          { paidAt: { $gte: startDate, $lte: endDate } },
          { paidAt: { $exists: false }, updatedAt: { $gte: startDate, $lte: endDate } },
          { paidAt: null, updatedAt: { $gte: startDate, $lte: endDate } }
        ]
      }).populate('patient', 'fullName mobileNumber');

      const totalFees = completedAppointments.reduce((sum, apt) => sum + (apt.appointmentFee || 0), 0);
      const totalDoctorShare = completedAppointments.reduce((sum, apt) => {
        // Use stored doctorShare if available, otherwise calculate
        if (apt.doctorShare !== undefined && apt.doctorShare > 0) {
          return sum + apt.doctorShare;
        }
        return sum + ((apt.appointmentFee || 0) * (100 - clinicPercentage) / 100);
      }, 0);
      const totalClinicShare = completedAppointments.reduce((sum, apt) => {
        if (apt.clinicShare !== undefined && apt.clinicShare > 0) {
          return sum + apt.clinicShare;
        }
        return sum + ((apt.appointmentFee || 0) * clinicPercentage / 100);
      }, 0);

      // Calculate how much has been paid to doctor
      const totalPaidToDoctor = completedAppointments.reduce((sum, apt) => sum + (apt.doctorPaidAmount || 0), 0);
      const remainingForDoctor = Math.round((totalDoctorShare - totalPaidToDoctor) * 100) / 100;

      // Get appointment details
      const appointments = completedAppointments.map(apt => ({
        _id: apt._id,
        type: 'appointment',
        date: apt.paidAt || apt.appointmentDateTime,
        patientName: apt.patient?.fullName || 'غير معروف',
        patientMobile: apt.patient?.mobileNumber || '',
        reason: apt.reason || 'كشف',
        totalFee: apt.appointmentFee || 0,
        doctorFee: apt.doctorFee || 0,
        clinicShare: apt.clinicShare || Math.round((apt.appointmentFee || 0) * clinicPercentage / 100),
        doctorShare: apt.doctorShare || Math.round((apt.appointmentFee || 0) * (100 - clinicPercentage) / 100),
        doctorPaid: apt.doctorPaid || false,
        doctorPaidAmount: apt.doctorPaidAmount || 0
      }));

      // Also get treatment cost income from doctor's Financial.transactions (debt payments split to doctor)
      // AND from paid debts on clinic owner's Financial that have this doctor's ID
      let treatmentIncome = 0;
      let treatmentClinicShare = 0;
      const treatmentTransactions = [];
      const clinicOwnerId2 = clinic.ownerId;
      try {
        // 1. Check doctor's own Financial transactions (income from debt payment splits)
        const doctorFinancial = await Financial.findOne({ doctorId: doc._id })
          .populate('transactions.patientId', 'fullName mobileNumber');
        if (doctorFinancial) {
          for (const txn of doctorFinancial.transactions) {
            // Only non-appointment transactions in the date range (debt payments, treatment income)
            if (txn.appointmentId) continue;
            const txnDate = new Date(txn.date);
            if (txnDate >= startDate && txnDate <= endDate) {
              treatmentIncome += txn.amount || 0;
              // Calculate the clinic share: if doctor got (100-pct)%, then original amount was txn.amount / (100-pct) * 100
              const originalAmount = clinicPercentage < 100 
                ? Math.round((txn.amount / (100 - clinicPercentage) * 100) * 100) / 100
                : txn.amount;
              treatmentClinicShare += originalAmount - txn.amount;
              treatmentTransactions.push({
                _id: txn._id,
                type: 'treatment',
                date: txnDate,
                patientName: txn.patientId?.fullName || 'غير معروف',
                patientMobile: txn.patientId?.mobileNumber || '',
                reason: txn.description || 'علاج',
                totalFee: originalAmount,
                doctorFee: txn.amount,
                clinicShare: Math.round((originalAmount - txn.amount) * 100) / 100,
                doctorShare: txn.amount,
                doctorPaid: true,
                doctorPaidAmount: txn.amount
              });
            }
          }
        }
      } catch (finErr) {
        console.error('Error fetching doctor financial for report:', finErr);
      }

      // Combine appointments and treatment transactions
      const allTransactions = [...appointments, ...treatmentTransactions];
      allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

      const totalTreatmentFees = treatmentTransactions.reduce((sum, t) => sum + t.totalFee, 0);

      report.push({
        doctor: {
          _id: doc._id,
          fullName: doc.fullName,
          specialty: doc.specialty,
          profileImage: doc.profileImage,
          consultationFee: doc.consultationFee
        },
        clinicPercentage,
        doctorPercentage: 100 - clinicPercentage,
        appointmentCount: completedAppointments.length,
        treatmentCount: treatmentTransactions.length,
        totalFees: totalFees + totalTreatmentFees,
        totalClinicShare: Math.round((totalClinicShare + treatmentClinicShare) * 100) / 100,
        totalDoctorShare: Math.round((totalDoctorShare + treatmentIncome) * 100) / 100,
        totalPaidToDoctor: Math.round((totalPaidToDoctor + treatmentIncome) * 100) / 100,
        remainingForDoctor: Math.max(0, remainingForDoctor),
        appointments: allTransactions
      });
    }

    // Summary
    const totalAllFees = report.reduce((sum, r) => sum + r.totalFees, 0);
    const totalAllClinicShare = report.reduce((sum, r) => sum + r.totalClinicShare, 0);
    const totalAllDoctorShare = report.reduce((sum, r) => sum + r.totalDoctorShare, 0);
    const totalAllPaid = report.reduce((sum, r) => sum + r.totalPaidToDoctor, 0);
    const totalAllRemaining = report.reduce((sum, r) => sum + r.remainingForDoctor, 0);

    res.status(200).json({
      success: true,
      report,
      summary: {
        totalFees: totalAllFees,
        totalClinicShare: Math.round(totalAllClinicShare * 100) / 100,
        totalDoctorShare: Math.round(totalAllDoctorShare * 100) / 100,
        totalPaidToDoctors: Math.round(totalAllPaid * 100) / 100,
        totalRemainingForDoctors: Math.round(totalAllRemaining * 100) / 100,
        month: filterMonth,
        year: filterYear
      }
    });
  } catch (error) {
    console.error('Error fetching doctor accounts report:', error);
    res.status(500).json({ message: 'فشل في جلب تقرير حسابات الأطباء', error: error.message });
  }
};

// Pay doctor their share
exports.payDoctor = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const { doctorId } = req.params;
    const { amount, paymentMethod, notes, appointmentIds } = req.body;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) return res.status(404).json({ message: 'لم يتم العثور على عيادة' });

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ message: 'يجب تحديد مبلغ صالح' });
    }

    const doctorEntry = clinic.doctors.find(d => d.doctorId.toString() === doctorId && d.status === 'active');
    if (!doctorEntry) {
      return res.status(404).json({ message: 'الطبيب غير موجود في العيادة' });
    }

    const paymentAmount = Number(amount);

    // If specific appointment IDs provided, mark them as paid
    if (appointmentIds && appointmentIds.length > 0) {
      let remainingPayment = paymentAmount;
      for (const aptId of appointmentIds) {
        if (remainingPayment <= 0) break;
        const apt = await Appointment.findById(aptId);
        if (apt && apt.doctorId.toString() === doctorId) {
          const doctorShareOwed = (apt.doctorShare || apt.appointmentFee || 0) - (apt.doctorPaidAmount || 0);
          if (doctorShareOwed > 0) {
            const paying = Math.min(remainingPayment, doctorShareOwed);
            apt.doctorPaidAmount = (apt.doctorPaidAmount || 0) + paying;
            apt.doctorPaid = apt.doctorPaidAmount >= (apt.doctorShare || apt.appointmentFee || 0);
            if (apt.doctorPaid) apt.doctorPaidAt = new Date();
            await apt.save();
            remainingPayment -= paying;
          }
        }
      }
    } else {
      // Pay oldest unpaid appointments first (FIFO)
      const unpaidAppointments = await Appointment.find({
        doctorId,
        status: 'completed',
        isPaid: true,
        doctorPaid: { $ne: true }
      }).sort({ paidAt: 1, appointmentDateTime: 1 });

      let remainingPayment = paymentAmount;
      for (const apt of unpaidAppointments) {
        if (remainingPayment <= 0) break;
        const doctorShareOwed = (apt.doctorShare || apt.appointmentFee || 0) - (apt.doctorPaidAmount || 0);
        if (doctorShareOwed > 0) {
          const paying = Math.min(remainingPayment, doctorShareOwed);
          apt.doctorPaidAmount = (apt.doctorPaidAmount || 0) + paying;
          apt.doctorPaid = apt.doctorPaidAmount >= (apt.doctorShare || apt.appointmentFee || 0);
          if (apt.doctorPaid) apt.doctorPaidAt = new Date();
          await apt.save();
          remainingPayment -= paying;
        }
      }
    }

    // Record the payment as an expense in clinic's Financial (salary/doctor payment)
    const clinicOwnerId = clinic.ownerId;
    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
    }

    const doctor = await User.findById(doctorId, 'fullName specialty');
    financial.expenses.push({
      amount: paymentAmount,
      description: `دفعة حصة طبيب - ${doctor?.fullName || ''} ${notes ? '(' + notes + ')' : ''}`,
      date: new Date(),
      category: 'Salary',
      employeeId: doctorId
    });
    financial.totalExpenses = (financial.totalExpenses || 0) + paymentAmount;
    await financial.save();

    res.status(200).json({
      success: true,
      message: `تم دفع ${paymentAmount} شيكل للطبيب ${doctor?.fullName || ''}`,
      payment: {
        doctorId,
        doctorName: doctor?.fullName,
        amount: paymentAmount,
        paymentMethod: paymentMethod || 'Cash',
        date: new Date()
      }
    });
  } catch (error) {
    console.error('Error paying doctor:', error);
    res.status(500).json({ message: 'فشل في تسجيل الدفع للطبيب', error: error.message });
  }
};

// Get all payment transactions for a specific patient
exports.getPatientPayments = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const { patientId } = req.params;
    const clinicOwnerId = clinic.ownerId;
    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      return res.status(200).json({ payments: [] });
    }

    const patientPayments = financial.transactions
      .filter(t => t.patientId?.toString() === patientId)
      .map(t => ({
        _id: t._id,
        amount: t.amount,
        description: t.description,
        date: t.date,
        paymentMethod: t.paymentMethod,
        appointmentId: t.appointmentId,
        lastEditedBy: t.lastEditedBy,
        lastEditedAt: t.lastEditedAt
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    // Populate lastEditedBy names
    const editedByIds = [...new Set(patientPayments.filter(p => p.lastEditedBy).map(p => p.lastEditedBy.toString()))];
    const editedByUsers = editedByIds.length > 0 ? await User.find({ _id: { $in: editedByIds } }).select('fullName') : [];
    const editedByMap = {};
    editedByUsers.forEach(u => { editedByMap[u._id.toString()] = u.fullName; });

    const paymentsWithNames = patientPayments.map(p => ({
      ...p,
      lastEditedBy: p.lastEditedBy ? { _id: p.lastEditedBy, fullName: editedByMap[p.lastEditedBy.toString()] || '' } : null
    }));

    res.status(200).json({ payments: paymentsWithNames });
  } catch (error) {
    console.error('Error getting patient payments:', error);
    res.status(500).json({ message: 'فشل في جلب الدفعات', error: error.message });
  }
};

// Edit a payment transaction
exports.editPayment = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const { transactionId } = req.params;
    const { amount, description, paymentMethod } = req.body;
    const clinicOwnerId = clinic.ownerId;

    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      return res.status(404).json({ message: 'لم يتم العثور على البيانات المالية' });
    }

    const transaction = financial.transactions.id(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'لم يتم العثور على الدفعة' });
    }

    // Adjust totalEarnings based on amount change
    const oldAmount = transaction.amount;
    const newAmount = Number(amount);
    financial.totalEarnings = (financial.totalEarnings || 0) - oldAmount + newAmount;

    // Update transaction fields
    transaction.amount = newAmount;
    if (description !== undefined) transaction.description = description;
    if (paymentMethod) transaction.paymentMethod = paymentMethod;
    // Audit trail
    transaction.lastEditedBy = accountantId;
    transaction.lastEditedAt = new Date();

    financial.markModified('transactions');
    await financial.save();

    // Populate accountant name for response
    const accountant = await User.findById(accountantId).select('fullName');

    res.status(200).json({
      success: true,
      message: 'تم تعديل الدفعة بنجاح',
      transaction: {
        _id: transaction._id,
        amount: transaction.amount,
        description: transaction.description,
        date: transaction.date,
        paymentMethod: transaction.paymentMethod,
        lastEditedBy: { _id: accountantId, fullName: accountant?.fullName },
        lastEditedAt: transaction.lastEditedAt
      }
    });
  } catch (error) {
    console.error('Error editing payment:', error);
    res.status(500).json({ message: 'فشل في تعديل الدفعة', error: error.message });
  }
};

// Delete a payment transaction
exports.deletePayment = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const { transactionId } = req.params;
    const clinicOwnerId = clinic.ownerId;

    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      return res.status(404).json({ message: 'لم يتم العثور على البيانات المالية' });
    }

    const transaction = financial.transactions.id(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'لم يتم العثور على الدفعة' });
    }

    // Reverse totalEarnings
    financial.totalEarnings = (financial.totalEarnings || 0) - transaction.amount;

    // Remove the transaction
    financial.transactions.pull(transactionId);
    await financial.save();

    res.status(200).json({
      success: true,
      message: 'تم حذف الدفعة بنجاح'
    });
  } catch (error) {
    console.error('Error deleting payment:', error);
    res.status(500).json({ message: 'فشل في حذف الدفعة', error: error.message });
  }
};

// Update medical record (doctor notes, diagnosis, etc.)
exports.updateMedicalRecord = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const { recordId } = req.params;
    const updateFields = req.body;

    // Find the record
    const record = await MedicalRecord.findById(recordId);
    if (!record) {
      return res.status(404).json({ message: 'لم يتم العثور على السجل الطبي' });
    }

    // Verify the record's doctor belongs to this clinic
    const doctorIds = clinic.doctors?.filter(d => d.status === 'active').map(d => d.doctorId.toString()) || [];
    doctorIds.push(clinic.ownerId.toString());
    if (!doctorIds.includes(record.doctor.toString())) {
      return res.status(403).json({ message: 'ليس لديك صلاحية لتعديل هذا السجل' });
    }

    // Allowed fields to update
    const allowedFields = [
      'diagnosis', 'treatmentPlan', 'treatment', 'notes', 'chiefComplaint',
      'historyOfPresentIllness', 'pastMedicalHistory', 'medications', 'allergies',
      'examinationFindings', 'investigations', 'title'
    ];

    for (const field of allowedFields) {
      if (updateFields[field] !== undefined) {
        record[field] = updateFields[field];
      }
    }

    // Audit trail
    record.lastEditedBy = accountantId;
    record.lastEditedAt = new Date();

    // Handle followUpNotes sub-fields
    if (updateFields.followUpNotes) {
      if (!record.followUpNotes) record.followUpNotes = {};
      const followUpFields = [
        'progressDescription', 'treatmentChanges', 'newSymptoms',
        'medicationResponse', 'sideEffects', 'complianceNotes',
        'outcomeNotes', 'nextSteps', 'recommendations',
        'progressStatus', 'patientCompliance'
      ];
      for (const field of followUpFields) {
        if (updateFields.followUpNotes[field] !== undefined) {
          record.followUpNotes[field] = updateFields.followUpNotes[field];
        }
      }
      record.markModified('followUpNotes');
    }

    await record.save();

    // Populate accountant name for response
    await record.populate('lastEditedBy', 'fullName');

    res.status(200).json({
      success: true,
      message: 'تم تعديل السجل الطبي بنجاح',
      record
    });
  } catch (error) {
    console.error('Error updating medical record:', error);
    res.status(500).json({ message: 'فشل في تعديل السجل الطبي', error: error.message });
  }
};