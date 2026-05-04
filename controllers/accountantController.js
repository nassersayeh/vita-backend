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

const hasTransactionForAppointment = (financial, appointmentId) => {
  if (!financial || !appointmentId) return false;
  const targetId = appointmentId.toString();
  return (financial.transactions || []).some((txn) =>
    txn.appointmentId?.toString() === targetId ||
    (txn.appointmentIds || []).some((id) => id.toString() === targetId)
  );
};

const hasTransactionForLabRequest = (financial, labRequestId) => {
  if (!financial || !labRequestId) return false;
  const targetId = labRequestId.toString();
  return (financial.transactions || []).some((txn) =>
    txn.labRequestId?.toString() === targetId ||
    (txn.labRequestIds || []).some((id) => id.toString() === targetId)
  );
};

const isLinkedFinancialTransaction = (transaction) => (
  !!transaction.appointmentId ||
  (transaction.appointmentIds && transaction.appointmentIds.length > 0) ||
  !!transaction.labRequestId ||
  (transaction.labRequestIds && transaction.labRequestIds.length > 0) ||
  !!transaction.orderId
);

const isProtectedFinancialTransaction = (transaction) => (
  isLinkedFinancialTransaction(transaction) ||
  !!transaction.patientId ||
  (transaction.totalDebtBeforeDiscount || 0) > 0 ||
  (transaction.discount || 0) > 0
);

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

    // Total outstanding debts from Appointment model
    const appointmentDebts = await Appointment.aggregate([
      { $match: { doctorId: { $in: doctorIds }, debt: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$debt' } } }
    ]).catch(() => []);

    // Get debts from Financial model - clinic owner is the single source of truth for debts
    const clinicOwnerId = clinic.ownerId;
    let financialDebts = 0;
    try {
      const ownerFinancialForDebts = await Financial.findOne({ doctorId: clinicOwnerId });
      if (ownerFinancialForDebts) {
        financialDebts = (ownerFinancialForDebts.debts || [])
          .filter(d => d.status === 'pending')
          .reduce((sum, d) => sum + (d.amount || 0), 0);
      }
    } catch (e) { /* ignore */ }

    // Use Financial.debts as the primary source of truth for debts
    // Appointment.debt is a secondary tracker that may be out of sync
    const totalDebts = financialDebts || appointmentDebts[0]?.total || 0;

    // Revenue source of truth: clinic owner's financial transactions.
    const clinicOwnerId2 = clinic.ownerId;
    let financialTodayIncome = 0;
    let financialMonthIncome = 0;
    try {
      const ownerFinancial = await Financial.findOne({ doctorId: clinicOwnerId2 });
      if (ownerFinancial && ownerFinancial.transactions) {
        for (const txn of ownerFinancial.transactions) {
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
        monthRevenue: financialMonthIncome,
        todayRevenue: financialTodayIncome,
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

    // Check if patient exists by mobile or ID number
    let patient = await User.findOne({ mobileNumber });
    let patientByIdNumber = await User.findOne({ idNumber });

    // Check for duplicates and return appropriate error message
    if (patient && patientByIdNumber && patient._id.toString() !== patientByIdNumber._id.toString()) {
      // Mobile number and ID number belong to different patients
      return res.status(400).json({ 
        success: false,
        message: `رقم الجوال ${mobileNumber} مرتبط برقم هوية مختلف! الرجاء التحقق من البيانات.`
      });
    }

    if (patient) {
      // Patient exists by mobile number
      if (patient.idNumber && patient.idNumber !== idNumber) {
        // Mobile number exists but with different ID number
        return res.status(400).json({ 
          success: false,
          message: `رقم الجوال ${mobileNumber} مسجل بالفعل برقم هوية ${patient.idNumber}! الرجاء التحقق من البيانات.`
        });
      }
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

    // Check if ID number already exists
    if (patientByIdNumber) {
      return res.status(400).json({ 
        success: false,
        message: `رقم الهوية ${idNumber} مسجل بالفعل برقم جوال ${patientByIdNumber.mobileNumber}! الرجاء التحقق من البيانات.`
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

    const savedPatient = await newPatient.save();
    console.log('✓ تم حفظ المريض في قاعدة البيانات:', savedPatient._id, savedPatient.fullName, savedPatient.mobileNumber);

    // Add patient to doctor(s)
    if (doctorId) {
      const doctor = await User.findById(doctorId);
      if (doctor && !doctor.patients.includes(savedPatient._id)) {
        doctor.patients.push(savedPatient._id);
        await doctor.save({ validateBeforeSave: false });
      }
    } else {
      // No specific doctor — add patient to all active clinic doctors
      const activeDoctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
      for (const docId of activeDoctorIds) {
        const doc = await User.findById(docId);
        if (doc && !doc.patients.includes(savedPatient._id)) {
          doc.patients.push(savedPatient._id);
          await doc.save({ validateBeforeSave: false });
        }
      }
    }

    res.status(201).json({
      success: true,
      message: 'تم تسجيل المريض بنجاح',
      patient: {
        _id: savedPatient._id,
        fullName: savedPatient.fullName,
        mobileNumber: savedPatient.mobileNumber,
        idNumber: savedPatient.idNumber
      },
      isExisting: false
    });
  } catch (error) {
    console.error('✗ خطأ في تسجيل المريض:', error);
    res.status(500).json({ 
      message: 'فشل في تسجيل المريض', 
      error: error.message,
      details: error.errmsg || error.toString()
    });
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
        appointmentId: appointment._id,
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

    // Record in CLINIC OWNER's financial (not doctor's)
    const clinicOwnerId = clinic.ownerId;
    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
    }

    const alreadyRecorded = hasTransactionForAppointment(financial, appointment._id);
    if (alreadyRecorded) {
      const populatedAppointment = await Appointment.findById(appointmentId)
        .populate('patient', 'fullName mobileNumber')
        .populate('doctorId', 'fullName specialty');

      return res.status(200).json({
        success: true,
        message: 'تم تسجيل الدفع سابقاً لهذا الموعد',
        appointment: populatedAppointment
      });
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
      d.patientId?.toString() === patientId &&
      d.status === 'pending' &&
      (!d.appointmentId || d.appointmentId.toString() === appointment._id.toString())
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

    // If there's remaining debt and NO pending debt entries were found to deduct from,
    // add a new debt entry. Otherwise, the FIFO loop already left the correct remaining.
    if (remaining > 0 && patientDebts.length === 0) {
      financial.debts.push({
        patientId: appointment.patient,
        doctorId: appointment.doctorId,
        appointmentId: appointment._id,
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

    if (!patientId || !doctorId || !testIds || testIds.length === 0) {
      return res.status(400).json({ message: 'يجب تحديد المريض والطبيب والفحوصات المطلوبة' });
    }

    // Find lab tech in clinic staff
    const labTechStaff = clinic.staff.find(s => s.role === 'LabTech' && s.status === 'active');
    const labId = labTechStaff ? labTechStaff.userId : null;

    // Verify tests exist
    const tests = await MedicalTest.find({ _id: { $in: testIds }, isActive: true });

    // Accountant does NOT set prices - only lab tech sets prices when processing
    const labRequest = new LabRequest({
      patientId,
      doctorId,
      labId: labId || null,
      testIds,
      notes,
      totalCost: 0,
      originalCost: 0,
      discount: 0,
      discountAmount: 0,
      requestedBy: accountantId,
      clinicId: clinic._id,
      approvalStatus: 'approved'
    });

    await labRequest.save();

    // No debt is created here - debt is added only when lab tech marks request as completed

    res.status(201).json({
      success: true,
      message: 'تم طلب الفحوصات بنجاح',
      labRequest
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

    // Record in CLINIC OWNER's financial
    const clinicOwnerId = clinic.ownerId;
    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
    }

    if (hasTransactionForLabRequest(financial, labRequest._id)) {
      return res.status(200).json({
        success: true,
        message: 'تم تسجيل دفع هذا الفحص سابقاً'
      });
    }

    const totalCost = labRequest.totalCost || labRequest.testIds.reduce((sum, t) => sum + (t.price || 0), 0);
    const paid = paymentAmount || totalCost;
    if (paid < totalCost) {
      return res.status(400).json({ message: 'دفعة المختبر الجزئية غير مدعومة من هذا المسار. يجب دفع كامل قيمة الفحص أو استخدام سداد الدين.' });
    }
    labRequest.totalCost = totalCost;
    labRequest.isPaid = true;
    labRequest.paidAmount = paid;
    labRequest.paidAt = new Date();
    labRequest.paidBy = accountantId;

    await labRequest.save();

    financial.transactions.push({
      amount: paid,
      description: `دفع فحوصات مخبرية`,
      date: new Date(),
      patientId: labRequest.patientId,
      labRequestId: labRequest._id,
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
          // Skip linked transactions already in report from Appointment/LabRequest queries.
          if (isLinkedFinancialTransaction(txn)) continue;
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
    const clinicOwnerId = clinic.ownerId;

    // ======== 1) Appointments paid in date range ========
    const aptQuery = {
      doctorId: { $in: doctorIds },
      patient: patientId,
      isPaid: true
    };
    if (startDate || endDate) {
      aptQuery.paidAt = {};
      if (startDate) aptQuery.paidAt.$gte = new Date(startDate);
      if (endDate) aptQuery.paidAt.$lte = new Date(endDate);
    }

    const appointments = await Appointment.find(aptQuery)
      .populate('patient', 'fullName mobileNumber idNumber')
      .populate('doctorId', 'fullName specialty')
      .sort({ paidAt: -1 });

    // ======== 2) Lab requests paid in date range ========
    const labQuery = {
      clinicId: clinic._id,
      patientId,
      isPaid: true
    };
    if (startDate || endDate) {
      labQuery.paidAt = {};
      if (startDate) labQuery.paidAt.$gte = new Date(startDate);
      if (endDate) labQuery.paidAt.$lte = new Date(endDate);
    }
    const labRequestsByClinic = await LabRequest.find(labQuery).populate('testIds', 'name price');
    const labQueryByDoc = {
      doctorId: { $in: doctorIds },
      patientId,
      isPaid: true
    };
    if (startDate || endDate) {
      labQueryByDoc.paidAt = {};
      if (startDate) labQueryByDoc.paidAt.$gte = new Date(startDate);
      if (endDate) labQueryByDoc.paidAt.$lte = new Date(endDate);
    }
    const labRequestsByDoc = await LabRequest.find(labQueryByDoc).populate('testIds', 'name price');
    const labRequestMap = new Map();
    for (const lr of [...labRequestsByClinic, ...labRequestsByDoc]) {
      labRequestMap.set(lr._id.toString(), lr);
    }
    const labRequests = Array.from(labRequestMap.values());

    // ======== 3) ALL lab requests for this patient (to look up test details from debts) ========
    const allPatientLabRequests = await LabRequest.find({
      patientId,
      $or: [
        { clinicId: clinic._id },
        { doctorId: { $in: doctorIds } }
      ]
    }).populate('testIds', 'name price');

    // ======== 4) Financial transactions (ONLY clinic owner's) ========
    const clinicFinancial = await Financial.findOne({ doctorId: clinicOwnerId });

    let clinicTransactions = [];
    if (clinicFinancial) {
      clinicTransactions = (clinicFinancial.transactions || [])
        .filter(t => t.patientId?.toString() === patientId);
      if (startDate) clinicTransactions = clinicTransactions.filter(t => t.date && new Date(t.date) >= new Date(startDate));
      if (endDate) clinicTransactions = clinicTransactions.filter(t => t.date && new Date(t.date) <= new Date(endDate));
    }

    // ======== 5) Collect all debts (pending + paid today) ========
    const allFinancialIds = [clinicOwnerId, ...doctorIds];
    const allFinancials = await Financial.find({ doctorId: { $in: allFinancialIds } });
    let patientDebts = [];
    let paidDebtsToday = [];
    for (const fin of allFinancials) {
      const finDebts = (fin.debts || []).filter(d =>
        d.patientId?.toString() === patientId && d.status === 'pending'
      );
      patientDebts = patientDebts.concat(finDebts);

      // Debts paid today — these tell us WHAT services were paid for
      const paidToday = (fin.debts || []).filter(d => {
        if (d.patientId?.toString() !== patientId) return false;
        if (d.status !== 'paid') return false;
        if (!d.paidAt) return false;
        const paidDate = new Date(d.paidAt);
        if (startDate && paidDate < new Date(startDate)) return false;
        if (endDate && paidDate > new Date(endDate)) return false;
        return true;
      });
      paidDebtsToday = paidDebtsToday.concat(paidToday);
    }
    const totalDebt = patientDebts.reduce((sum, d) => sum + (d.amount || 0), 0);

    // ======== 6) Build items ========
    const items = [];
    const coveredAptIds = new Set();

    // 6a) Appointments paid in range
    for (const apt of appointments) {
      const totalFee = (apt.doctorFee || 0) + (apt.clinicFee || apt.appointmentFee || 0);
      items.push({
        category: 'كشف طبي',
        serviceName: apt.reason || 'كشف طبي',
        servicePrice: totalFee || apt.paymentAmount || 0,
        paidAmount: apt.paymentAmount || 0,
        discount: 0,
        discountAmount: 0,
        doctor: apt.doctorId?.fullName || '',
        date: apt.paidAt,
        paymentMethod: apt.paymentMethod || ''
      });
      coveredAptIds.add(apt._id.toString());
    }

    // 6b) Lab requests paid in range (directly via markTestAsPaid or approveLabRequest)
    const coveredLabRequestIds = new Set();
    for (const lab of labRequests) {
      const tests = lab.testIds || [];
      const discount = lab.discount || 0;
      if (tests.length > 0) {
        const labPaid = lab.paidAmount || lab.totalCost || 0;
        const totalOriginal = tests.reduce((s, t) => s + (t.price || 0), 0);
        for (let i = 0; i < tests.length; i++) {
          const test = tests[i];
          const testPrice = test.price || 0;
          let testPaid;
          if (totalOriginal > 0) {
            testPaid = Math.round((testPrice / totalOriginal) * labPaid);
          } else {
            testPaid = Math.round(labPaid / tests.length);
          }
          if (i === tests.length - 1) {
            const sumSoFar = tests.slice(0, -1).reduce((s, t2) => {
              return s + Math.round(((t2.price || 0) / totalOriginal) * labPaid);
            }, 0);
            testPaid = labPaid - sumSoFar;
          }
          const testDiscount = discount > 0 ? Math.round(testPrice * discount / 100) : 0;
          items.push({
            category: 'فحص مخبري',
            serviceName: test.name || 'فحص',
            servicePrice: testPrice,
            paidAmount: testPaid,
            discount: discount,
            discountAmount: testDiscount,
            doctor: '',
            date: lab.paidAt,
            paymentMethod: ''
          });
        }
      } else {
        items.push({
          category: 'فحوصات مخبرية',
          serviceName: lab.testName || 'فحوصات',
          servicePrice: lab.originalCost || lab.totalCost || 0,
          paidAmount: lab.paidAmount || lab.totalCost || 0,
          discount: discount,
          discountAmount: discount > 0 ? Math.round((lab.originalCost || lab.totalCost || 0) * discount / 100) : 0,
          doctor: '',
          date: lab.paidAt,
          paymentMethod: ''
        });
      }
      coveredLabRequestIds.add(lab._id.toString());
    }

    // 6c) Debts paid today → break down into detailed service items
    //     This covers the case where insertPayment pays debts but doesn't mark LabRequests as isPaid

    // Find insertPayment transactions to get bulk discount info
    const insertPaymentTxns = clinicTransactions.filter(t =>
      t.totalDebtBeforeDiscount > 0 || t.description === 'دفعة من مريض' || (t.description || '').includes('دفعة مريض')
    );
    // Build a function to find the discount % that applies to a debt based on paidAt time
    const getDiscountForDebt = (debtPaidAt) => {
      if (!debtPaidAt || insertPaymentTxns.length === 0) return { discountPercent: 0, discountAmount: 0 };
      // Find the insertPayment transaction closest in time to this debt's paidAt
      const debtTime = new Date(debtPaidAt).getTime();
      let bestMatch = null;
      let bestDiff = Infinity;
      for (const txn of insertPaymentTxns) {
        const txnTime = new Date(txn.date).getTime();
        const diff = Math.abs(txnTime - debtTime);
        if (diff < bestDiff && diff < 60000) { // within 1 minute
          bestDiff = diff;
          bestMatch = txn;
        }
      }
      if (bestMatch && bestMatch.discountPercent > 0) {
        return { discountPercent: bestMatch.discountPercent, totalDebtBeforeDiscount: bestMatch.totalDebtBeforeDiscount || 0 };
      }
      return { discountPercent: 0, totalDebtBeforeDiscount: 0 };
    };

    const coveredDebtDescs = new Set();
    for (const debt of paidDebtsToday) {
      const desc = debt.description || '';
      const originalAmount = debt.originalAmount || debt.amount || 0;
      const debtDate = debt.paidAt || debt.date;
      // Get the discount info from the matching insertPayment transaction
      const { discountPercent: bulkDiscountPct } = getDiscountForDebt(debtDate);
      const debtDiscountAmount = bulkDiscountPct > 0 ? Math.round(originalAmount * bulkDiscountPct / 100) : 0;
      const debtPaidAmount = originalAmount - debtDiscountAmount;

      // Check: is this debt for an appointment we already listed?
      const isAptDebt = desc.includes('كشفية') || desc.includes('دين موعد') || desc.match(/^موعد /);
      if (isAptDebt) {
        // Check if any appointment item already covers a similar amount
        const alreadyCovered = items.some(it =>
          it.category === 'كشف طبي' &&
          Math.abs(new Date(it.date || 0) - new Date(debtDate || 0)) < 120000
        );
        if (alreadyCovered) continue;
        // Show as appointment
        let serviceName = desc.replace('كشفية العيادة - ', '').replace('دين موعد - ', '').replace('موعد - ', '');
        items.push({
          category: 'كشف طبي',
          serviceName: serviceName || 'كشف طبي',
          servicePrice: originalAmount,
          paidAmount: debtPaidAmount,
          discount: bulkDiscountPct, discountAmount: debtDiscountAmount,
          doctor: '', date: debtDate, paymentMethod: ''
        });
        coveredDebtDescs.add(desc);
        continue;
      }

      // Check: is this debt for lab tests?
      const isLabDebt = desc.includes('فحوصات مخبرية') || desc.includes('فحص مخبري');
      if (isLabDebt) {
        // Try to find the actual LabRequest to get individual test names & prices
        // Extract test names from debt description like "فحوصات مخبرية - CBC, RFT" or "فحوصات مخبرية (CBC, RFT)"
        const testNamesStr = desc
          .replace(/فحوصات مخبرية\s*[-–]\s*/, '')
          .replace(/فحوصات مخبرية\s*\(/, '')
          .replace(/\)/, '')
          .replace(/\s*-\s*خصم \d+%/, '')
          .trim();

        // Try to match with an actual LabRequest by test names
        let matchedLab = null;
        for (const lr of allPatientLabRequests) {
          if (coveredLabRequestIds.has(lr._id.toString())) continue;
          const lrTestNames = (lr.testIds || []).map(t => t.name).join(', ');
          if (lrTestNames === testNamesStr || desc.includes(lrTestNames)) {
            matchedLab = lr;
            break;
          }
        }

        if (matchedLab && matchedLab.testIds && matchedLab.testIds.length > 0) {
          // We found the actual lab request — show individual tests!
          const tests = matchedLab.testIds;
          // Use bulk discount from insertPayment, or lab's own discount if no bulk discount
          const effectiveDiscountPct = bulkDiscountPct > 0 ? bulkDiscountPct : (matchedLab.discount || 0);
          const totalOriginal = tests.reduce((s, t) => s + (t.price || 0), 0);
          const effectivePaid = debtPaidAmount; // What was actually paid for this debt after discount
          for (let i = 0; i < tests.length; i++) {
            const test = tests[i];
            const testPrice = test.price || 0;
            let testPaid;
            if (totalOriginal > 0) {
              testPaid = Math.round((testPrice / totalOriginal) * effectivePaid);
            } else {
              testPaid = Math.round(effectivePaid / tests.length);
            }
            if (i === tests.length - 1) {
              const sumSoFar = tests.slice(0, -1).reduce((s, t2) => {
                return s + Math.round(((t2.price || 0) / totalOriginal) * effectivePaid);
              }, 0);
              testPaid = effectivePaid - sumSoFar;
            }
            const testDiscount = effectiveDiscountPct > 0 ? Math.round(testPrice * effectiveDiscountPct / 100) : 0;
            items.push({
              category: 'فحص مخبري',
              serviceName: test.name || 'فحص',
              servicePrice: testPrice,
              paidAmount: testPaid,
              discount: effectiveDiscountPct,
              discountAmount: testDiscount,
              doctor: '',
              date: debtDate,
              paymentMethod: ''
            });
          }
          coveredLabRequestIds.add(matchedLab._id.toString());
        } else {
          // Couldn't find the LabRequest — show test names from debt description
          // Split comma-separated test names
          const testNames = testNamesStr.split(',').map(n => n.trim()).filter(Boolean);
          if (testNames.length > 1) {
            const perTestPrice = Math.round(originalAmount / testNames.length);
            const perTestPaid = Math.round(debtPaidAmount / testNames.length);
            for (let i = 0; i < testNames.length; i++) {
              const price = i === testNames.length - 1 ? originalAmount - perTestPrice * (testNames.length - 1) : perTestPrice;
              const paid = i === testNames.length - 1 ? debtPaidAmount - perTestPaid * (testNames.length - 1) : perTestPaid;
              const disc = bulkDiscountPct > 0 ? Math.round(price * bulkDiscountPct / 100) : 0;
              items.push({
                category: 'فحص مخبري',
                serviceName: testNames[i],
                servicePrice: price,
                paidAmount: paid,
                discount: bulkDiscountPct, discountAmount: disc,
                doctor: '', date: debtDate, paymentMethod: ''
              });
            }
          } else {
            items.push({
              category: 'فحوصات مخبرية',
              serviceName: testNamesStr || 'فحوصات مخبرية',
              servicePrice: originalAmount,
              paidAmount: debtPaidAmount,
              discount: bulkDiscountPct, discountAmount: debtDiscountAmount,
              doctor: '', date: debtDate, paymentMethod: ''
            });
          }
        }
        coveredDebtDescs.add(desc);
        continue;
      }

      // Generic debt — show as-is
      coveredDebtDescs.add(desc);
      items.push({
        category: 'دفعة على الحساب',
        serviceName: desc || 'دفعة',
        servicePrice: originalAmount,
        paidAmount: debtPaidAmount,
        discount: bulkDiscountPct, discountAmount: debtDiscountAmount,
        doctor: '', date: debtDate, paymentMethod: ''
      });
    }

    // 6d) Financial transactions — only show ones NOT already covered
    for (const txn of clinicTransactions) {
      const desc = txn.description || '';
      // Always skip internal entries
      if (desc.includes('حصة الطبيب')) continue;
      // Skip if this transaction covers appointments we've already shown
      if (txn.appointmentId && coveredAptIds.has(txn.appointmentId.toString())) continue;
      if (txn.appointmentIds && txn.appointmentIds.some(id => coveredAptIds.has(id.toString()))) continue;
      if (desc.includes('دفع موعد')) continue;
      if (desc.includes('دفع فحوصات مخبرية') || desc.includes('دفع فحوصات')) continue;
      if (desc.includes('إتمام موعد')) continue;
      // Skip insertPayment bulk transactions — debts already broken down above with discounts
      if (txn.totalDebtBeforeDiscount || desc === 'دفعة من مريض' || desc.includes('دفعة مريض') || desc === 'دفعة من مريض') {
        continue;
      }
      // Check if this is a custom description payment that we haven't seen
      // If items already cover the amount, skip
      const alreadyCoveredByItems = items.some(it =>
        Math.abs((it.paidAmount || 0) - (txn.amount || 0)) < 1 &&
        it.date && txn.date &&
        Math.abs(new Date(it.date) - new Date(txn.date)) < 120000
      );
      if (alreadyCoveredByItems) continue;

      items.push({
        category: 'دفعة على الحساب',
        serviceName: desc || 'دفعة',
        servicePrice: txn.amount || 0,
        paidAmount: txn.amount || 0,
        discount: 0, discountAmount: 0,
        doctor: '', date: txn.date,
        paymentMethod: txn.paymentMethod || ''
      });
    }

    // Sort all items by date descending
    items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    // Calculate totals
    const totalServicePrice = items.reduce((sum, item) => sum + (item.servicePrice || 0), 0);
    const totalPaid = items.reduce((sum, item) => sum + (item.paidAmount || 0), 0);
    const totalDiscountAmount = items.reduce((sum, item) => sum + (item.discountAmount || 0), 0);

    const patient = await User.findById(patientId, 'fullName mobileNumber idNumber');

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
          category: item.category,
          serviceName: item.serviceName,
          servicePrice: item.servicePrice,
          paidAmount: item.paidAmount,
          discount: item.discount || 0,
          discountAmount: item.discountAmount || 0,
          doctor: item.doctor || '',
          date: item.date,
          paymentMethod: item.paymentMethod || ''
        })),
        totalServicePrice,
        totalDiscountAmount,
        total: totalPaid,
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

// Get detail for a SINGLE invoice/transaction by its _id
exports.getInvoiceDetail = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة' });
    }

    const { transactionId } = req.params;
    const clinicOwnerId = clinic.ownerId;
    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);

    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      return res.status(404).json({ message: 'لا توجد بيانات مالية' });
    }

    const txn = (financial.transactions || []).find(t => t._id.toString() === transactionId);
    if (!txn) {
      return res.status(404).json({ message: 'الفاتورة غير موجودة' });
    }

    const patientId = txn.patientId?.toString();
    const desc = txn.description || '';
    const txnDate = new Date(txn.date);
    const items = [];

    // ===== CASE 1: insertPayment (has totalDebtBeforeDiscount) =====
    if (txn.totalDebtBeforeDiscount) {
      const bulkDiscountPct = txn.discountPercent || 0;
      const bulkDiscountTotal = txn.discount || 0;
      // Find debts that were paid around the same time as this transaction (within 10 seconds)
      const allFinancialIds = [clinicOwnerId, ...doctorIds];
      const allFinancials = await Financial.find({ doctorId: { $in: allFinancialIds } });
      let paidDebts = [];
      for (const fin of allFinancials) {
        const matched = (fin.debts || []).filter(d => {
          if (d.patientId?.toString() !== patientId) return false;
          if (d.status !== 'paid') return false;
          if (!d.paidAt) return false;
          return Math.abs(new Date(d.paidAt) - txnDate) < 10000; // within 10 seconds
        });
        paidDebts = paidDebts.concat(matched);
      }

      // Also find appointments that were marked as paid at the same time
      const paidAppointments = await Appointment.find({
        patient: patientId,
        doctorId: { $in: [...doctorIds, clinicOwnerId] },
        isPaid: true,
        paidAt: { $gte: new Date(txnDate - 10000), $lte: new Date(txnDate.getTime() + 10000) }
      }).populate('doctorId', 'fullName specialty');

      // Get all patient lab requests for matching debt descriptions
      const allPatientLabRequests = await LabRequest.find({
        patientId,
        $or: [
          { clinicId: clinic._id },
          { doctorId: { $in: doctorIds } }
        ]
      }).populate('testIds', 'name price');

      const coveredLabIds = new Set();

      // Process paid debts into items
      for (const debt of paidDebts) {
        const debtDesc = debt.description || '';
        const originalAmount = debt.originalAmount || debt.amount || 0;
        // Calculate per-debt discount from the bulk discount
        const debtDiscountAmt = bulkDiscountPct > 0 ? Math.round(originalAmount * bulkDiscountPct / 100) : 0;
        const debtPaidAmt = originalAmount - debtDiscountAmt;

        // Is this an appointment debt?
        const isAptDebt = debtDesc.includes('كشفية') || debtDesc.includes('دين موعد') || debtDesc.match(/^موعد /);
        if (isAptDebt) {
          // Try to find matching appointment
          const matchingApt = paidAppointments.find(a =>
            Math.abs(new Date(a.paidAt) - new Date(debt.paidAt)) < 10000
          );
          items.push({
            category: 'كشف طبي',
            serviceName: matchingApt?.reason || debtDesc.replace('كشفية العيادة - ', '').replace('دين موعد - ', '').replace('موعد - ', '') || 'كشف طبي',
            servicePrice: originalAmount,
            paidAmount: debtPaidAmt,
            discount: bulkDiscountPct, discountAmount: debtDiscountAmt,
            doctor: matchingApt?.doctorId?.fullName || '',
            date: debt.paidAt
          });
          continue;
        }

        // Is this a lab test debt?
        const isLabDebt = debtDesc.includes('فحوصات مخبرية') || debtDesc.includes('فحص مخبري');
        if (isLabDebt) {
          // Extract test names from description
          const testNamesStr = debtDesc
            .replace(/فحوصات مخبرية\s*[-–]\s*/, '')
            .replace(/فحوصات مخبرية\s*\(/, '')
            .replace(/\)/, '')
            .replace(/\s*-\s*خصم \d+%/, '')
            .trim();

          // Try to match with actual LabRequest
          let matchedLab = null;
          for (const lr of allPatientLabRequests) {
            if (coveredLabIds.has(lr._id.toString())) continue;
            const lrTestNames = (lr.testIds || []).map(t => t.name).join(', ');
            if (lrTestNames === testNamesStr || debtDesc.includes(lrTestNames)) {
              matchedLab = lr;
              break;
            }
          }

          if (matchedLab && matchedLab.testIds && matchedLab.testIds.length > 0) {
            const tests = matchedLab.testIds;
            const effectiveDiscountPct = bulkDiscountPct > 0 ? bulkDiscountPct : (matchedLab.discount || 0);
            const totalOriginal = tests.reduce((s, t) => s + (t.price || 0), 0);
            const effectivePaid = debtPaidAmt; // after discount
            for (let i = 0; i < tests.length; i++) {
              const test = tests[i];
              const testPrice = test.price || 0;
              let testPaid;
              if (totalOriginal > 0) {
                testPaid = Math.round((testPrice / totalOriginal) * effectivePaid);
              } else {
                testPaid = Math.round(effectivePaid / tests.length);
              }
              if (i === tests.length - 1) {
                const sumSoFar = tests.slice(0, -1).reduce((s, t2) => {
                  return s + Math.round(((t2.price || 0) / totalOriginal) * effectivePaid);
                }, 0);
                testPaid = effectivePaid - sumSoFar;
              }
              const testDiscount = effectiveDiscountPct > 0 ? Math.round(testPrice * effectiveDiscountPct / 100) : 0;
              items.push({
                category: 'فحص مخبري',
                serviceName: test.name || 'فحص',
                servicePrice: testPrice,
                paidAmount: testPaid,
                discount: effectiveDiscountPct, discountAmount: testDiscount,
                doctor: '', date: debt.paidAt
              });
            }
            coveredLabIds.add(matchedLab._id.toString());
          } else {
            // Parse test names from description
            const testNames = testNamesStr.split(',').map(n => n.trim()).filter(Boolean);
            if (testNames.length > 1) {
              const perTestPrice = Math.round(originalAmount / testNames.length);
              const perTestPaid = Math.round(debtPaidAmt / testNames.length);
              for (let i = 0; i < testNames.length; i++) {
                const price = i === testNames.length - 1 ? originalAmount - perTestPrice * (testNames.length - 1) : perTestPrice;
                const paid = i === testNames.length - 1 ? debtPaidAmt - perTestPaid * (testNames.length - 1) : perTestPaid;
                const disc = bulkDiscountPct > 0 ? Math.round(price * bulkDiscountPct / 100) : 0;
                items.push({
                  category: 'فحص مخبري',
                  serviceName: testNames[i],
                  servicePrice: price, paidAmount: paid,
                  discount: bulkDiscountPct, discountAmount: disc,
                  doctor: '', date: debt.paidAt
                });
              }
            } else {
              items.push({
                category: 'فحوصات مخبرية',
                serviceName: testNamesStr || 'فحوصات مخبرية',
                servicePrice: originalAmount, paidAmount: debtPaidAmt,
                discount: bulkDiscountPct, discountAmount: debtDiscountAmt,
                doctor: '', date: debt.paidAt
              });
            }
          }
          continue;
        }

        // Generic debt
        items.push({
          category: 'دفعة على الحساب',
          serviceName: debtDesc || 'دفعة',
          servicePrice: originalAmount, paidAmount: debtPaidAmt,
          discount: bulkDiscountPct, discountAmount: debtDiscountAmt,
          doctor: '', date: debt.paidAt
        });
      }

      // If no debts found but we have paid appointments, add them
      if (paidDebts.length === 0 && paidAppointments.length > 0) {
        for (const apt of paidAppointments) {
          const totalFee = (apt.doctorFee || 0) + (apt.clinicFee || apt.appointmentFee || 0);
          items.push({
            category: 'كشف طبي',
            serviceName: apt.reason || 'كشف طبي',
            servicePrice: totalFee || apt.paymentAmount || 0,
            paidAmount: apt.paymentAmount || 0,
            discount: 0, discountAmount: 0,
            doctor: apt.doctorId?.fullName || '',
            date: apt.paidAt
          });
        }
      }
    }
    // ===== CASE 2: markAsPaid or completeAppointment (has appointmentId) =====
    else if (txn.appointmentId) {
      const appointment = await Appointment.findById(txn.appointmentId)
        .populate('doctorId', 'fullName specialty');
      if (appointment) {
        const totalFee = (appointment.doctorFee || 0) + (appointment.clinicFee || appointment.appointmentFee || 0);
        items.push({
          category: 'كشف طبي',
          serviceName: appointment.reason || 'كشف طبي',
          servicePrice: totalFee || appointment.paymentAmount || 0,
          paidAmount: txn.amount || appointment.paymentAmount || 0,
          discount: 0, discountAmount: 0,
          doctor: appointment.doctorId?.fullName || '',
          date: txn.date
        });
        // If there's a breakdown in description (إتمام موعد), show clinic vs doctor fees
        if (desc.includes('إتمام موعد') && appointment.doctorFee > 0 && appointment.clinicFee > 0) {
          // Already shown as single line with total, no need to split further
        }
      } else {
        items.push({
          category: 'كشف طبي',
          serviceName: desc || 'كشف طبي',
          servicePrice: txn.amount || 0,
          paidAmount: txn.amount || 0,
          discount: 0, discountAmount: 0,
          doctor: '', date: txn.date
        });
      }
    }
    // ===== CASE 3: دفع فحوصات مخبرية (markTestAsPaid or approveLabRequest with payment) =====
    else if (desc.includes('دفع فحوصات مخبرية')) {
      // Extract test names from description like "دفع فحوصات مخبرية (CBC, RFT)"
      const testNamesMatch = desc.match(/دفع فحوصات مخبرية\s*\(([^)]+)\)/);
      const testNamesStr = testNamesMatch ? testNamesMatch[1] : '';

      // Try to find matching LabRequest
      const allPatientLabRequests = await LabRequest.find({
        patientId,
        $or: [
          { clinicId: clinic._id },
          { doctorId: { $in: doctorIds } }
        ]
      }).populate('testIds', 'name price');

      let matchedLab = null;
      if (testNamesStr) {
        for (const lr of allPatientLabRequests) {
          const lrTestNames = (lr.testIds || []).map(t => t.name).join(', ');
          if (lrTestNames === testNamesStr || desc.includes(lrTestNames)) {
            // Additional check: paid amount should be close
            if (lr.paidAt && Math.abs(new Date(lr.paidAt) - txnDate) < 60000) {
              matchedLab = lr;
              break;
            }
          }
        }
        // If no time match found, try just by test names
        if (!matchedLab) {
          for (const lr of allPatientLabRequests) {
            const lrTestNames = (lr.testIds || []).map(t => t.name).join(', ');
            if (lrTestNames === testNamesStr || desc.includes(lrTestNames)) {
              matchedLab = lr;
              break;
            }
          }
        }
      }

      if (matchedLab && matchedLab.testIds && matchedLab.testIds.length > 0) {
        const tests = matchedLab.testIds;
        const discount = matchedLab.discount || 0;
        const totalOriginal = tests.reduce((s, t) => s + (t.price || 0), 0);
        const labPaid = txn.amount || matchedLab.paidAmount || matchedLab.totalCost || 0;
        for (let i = 0; i < tests.length; i++) {
          const test = tests[i];
          const testPrice = test.price || 0;
          let testPaid;
          if (totalOriginal > 0) {
            testPaid = Math.round((testPrice / totalOriginal) * labPaid);
          } else {
            testPaid = Math.round(labPaid / tests.length);
          }
          if (i === tests.length - 1) {
            const sumSoFar = tests.slice(0, -1).reduce((s, t2) => {
              return s + Math.round(((t2.price || 0) / totalOriginal) * labPaid);
            }, 0);
            testPaid = labPaid - sumSoFar;
          }
          const testDiscount = discount > 0 ? Math.round(testPrice * discount / 100) : 0;
          items.push({
            category: 'فحص مخبري',
            serviceName: test.name || 'فحص',
            servicePrice: testPrice,
            paidAmount: testPaid,
            discount, discountAmount: testDiscount,
            doctor: '', date: txn.date
          });
        }
      } else {
        // Couldn't find LabRequest, parse from description
        const testNames = testNamesStr ? testNamesStr.split(',').map(n => n.trim()).filter(Boolean) : [];
        if (testNames.length > 1) {
          const perTestPrice = Math.round((txn.amount || 0) / testNames.length);
          for (let i = 0; i < testNames.length; i++) {
            const amt = i === testNames.length - 1 ? (txn.amount || 0) - perTestPrice * (testNames.length - 1) : perTestPrice;
            items.push({
              category: 'فحص مخبري',
              serviceName: testNames[i],
              servicePrice: amt, paidAmount: amt,
              discount: 0, discountAmount: 0,
              doctor: '', date: txn.date
            });
          }
        } else {
          items.push({
            category: 'فحوصات مخبرية',
            serviceName: testNamesStr || 'فحوصات مخبرية',
            servicePrice: txn.amount || 0,
            paidAmount: txn.amount || 0,
            discount: 0, discountAmount: 0,
            doctor: '', date: txn.date
          });
        }
      }
    }
    // ===== CASE 4: Generic / other transaction =====
    else {
      items.push({
        category: desc.includes('موعد') ? 'كشف طبي' : 'دفعة',
        serviceName: desc || 'دفعة',
        servicePrice: txn.amount || 0,
        paidAmount: txn.amount || 0,
        discount: 0, discountAmount: 0,
        doctor: '', date: txn.date
      });
    }

    // Calculate totals
    const totalServicePrice = items.reduce((sum, item) => sum + (item.servicePrice || 0), 0);
    const totalPaid = items.reduce((sum, item) => sum + (item.paidAmount || 0), 0);
    const totalDiscountAmount = items.reduce((sum, item) => sum + (item.discountAmount || 0), 0)
      + (txn.discount || 0);

    // Get patient's current debt
    const allFinancialIds = [clinicOwnerId, ...doctorIds];
    const allFinancials = await Financial.find({ doctorId: { $in: allFinancialIds } });
    let totalDebt = 0;
    let debts = [];
    for (const fin of allFinancials) {
      const finDebts = (fin.debts || []).filter(d =>
        d.patientId?.toString() === patientId && d.status === 'pending'
      );
      for (const d of finDebts) {
        totalDebt += d.amount || 0;
        debts.push({ description: d.description, amount: d.amount, date: d.date });
      }
    }

    const patient = await User.findById(patientId, 'fullName mobileNumber idNumber');

    res.status(200).json({
      success: true,
      receipt: {
        items: items.map(item => ({
          category: item.category,
          serviceName: item.serviceName,
          servicePrice: item.servicePrice,
          paidAmount: item.paidAmount,
          discount: item.discount || 0,
          discountAmount: item.discountAmount || 0,
          doctor: item.doctor || '',
          date: item.date
        })),
        totalServicePrice,
        totalDiscountAmount,
        total: totalPaid,
        totalDebt,
        debts,
        patient: patient ? {
          fullName: patient.fullName,
          mobileNumber: patient.mobileNumber,
          idNumber: patient.idNumber
        } : null
      }
    });
  } catch (error) {
    console.error('Error getting invoice detail:', error);
    res.status(500).json({ message: 'فشل في جلب تفاصيل الفاتورة', error: error.message });
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

// Search patient in the entire network by mobile number
exports.searchNetworkPatient = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const { mobileNumber } = req.query;
    if (!mobileNumber || mobileNumber.trim().length < 3) {
      return res.status(400).json({ message: 'يرجى إدخال رقم جوال صحيح' });
    }

    // Search in all Users (patients)
    const patient = await User.findOne({
      role: 'User',
      mobileNumber: { $regex: mobileNumber.trim(), $options: 'i' }
    }).select('-password -resetCode -twoFactorCode -phoneVerificationCode -twoFactorCodeExpiration -phoneVerificationCodeExpiration -resetCodeExpiration');

    if (!patient) {
      return res.status(404).json({ success: false, message: 'لم يتم العثور على مريض بهذا الرقم' });
    }

    // Check if patient is already in this clinic
    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
    const clinicDoctors = await User.find({ _id: { $in: doctorIds } }).select('patients fullName specialty');
    const isInClinic = clinicDoctors.some(doc => (doc.patients || []).some(p => p.toString() === patient._id.toString()));

    // Get all medical records for this patient (from ALL doctors, not just clinic)
    const allRecords = await MedicalRecord.find({ patient: patient._id })
      .populate('doctor', 'fullName specialty')
      .sort({ createdAt: -1 })
      .limit(50);

    // Get lab requests
    const labRequests = await LabRequest.find({ patientId: patient._id })
      .populate('testIds', 'name price')
      .populate('doctorId', 'fullName specialty')
      .sort({ createdAt: -1 })
      .limit(30);

    // Get appointments history
    const appointments = await Appointment.find({ patient: patient._id })
      .populate('doctorId', 'fullName specialty')
      .sort({ appointmentDateTime: -1 })
      .limit(30);

    res.status(200).json({
      success: true,
      patient: patient.toObject(),
      isInClinic,
      medicalRecords: allRecords,
      labRequests,
      appointments,
      stats: {
        totalRecords: allRecords.length,
        totalLabRequests: labRequests.length,
        totalAppointments: appointments.length,
      }
    });
  } catch (error) {
    console.error('Error searching network patient:', error);
    res.status(500).json({ message: 'فشل في البحث في الشبكة', error: error.message });
  }
};

// Add a patient from the network to the clinic
exports.addPatientToClinic = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const { patientId, doctorId } = req.body;
    if (!patientId) {
      return res.status(400).json({ message: 'يرجى تحديد المريض' });
    }

    const patient = await User.findById(patientId);
    if (!patient || patient.role !== 'User') {
      return res.status(404).json({ message: 'المريض غير موجود' });
    }

    const activeDoctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);

    if (doctorId) {
      // Add to specific doctor
      if (!activeDoctorIds.some(id => id.toString() === doctorId)) {
        return res.status(403).json({ message: 'الطبيب غير موجود في هذه العيادة' });
      }
      const doctor = await User.findById(doctorId);
      if (doctor && !doctor.patients.includes(patient._id)) {
        doctor.patients.push(patient._id);
        await doctor.save({ validateBeforeSave: false });
      }
    } else {
      // Add to all active clinic doctors
      for (const docId of activeDoctorIds) {
        const doc = await User.findById(docId);
        if (doc && !doc.patients.includes(patient._id)) {
          doc.patients.push(patient._id);
          await doc.save({ validateBeforeSave: false });
        }
      }
    }

    res.status(200).json({
      success: true,
      message: 'تم إضافة المريض إلى العيادة بنجاح',
      patient: {
        _id: patient._id,
        fullName: patient.fullName,
        mobileNumber: patient.mobileNumber,
        idNumber: patient.idNumber
      }
    });
  } catch (error) {
    console.error('Error adding patient to clinic:', error);
    res.status(500).json({ message: 'فشل في إضافة المريض', error: error.message });
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
    // BUT only if a debt wasn't already added during createAppointment
    const fee = appointment.clinicFee || appointment.appointmentFee || 0;
    if (fee > 0) {
      const clinicOwnerId = clinic.ownerId;
      let financial = await Financial.findOne({ doctorId: clinicOwnerId });
      if (!financial) {
        financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
      }
      // Check if a pending debt for this patient+appointment already exists (from createAppointment)
      const existingDebt = (financial.debts || []).find(d =>
        d.patientId?.toString() === appointment.patient.toString() &&
        d.status === 'pending' &&
        (
          d.appointmentId?.toString() === appointment._id.toString() ||
          (!d.appointmentId && d.amount === fee)
        )
      );
      if (!existingDebt) {
        financial.debts.push({
          patientId: appointment.patient,
          doctorId: appointment.doctorId,
          appointmentId: appointment._id,
          amount: fee,
          description: 'موعد - ' + (appointment.reason || 'كشف عام'),
          date: new Date(),
          status: 'pending'
        });
        financial.markModified('debts');
        await financial.save();
      }
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

    const clinicOwnerId = clinic.ownerId;
    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (financial) {
      const relatedDebts = (financial.debts || []).filter(d =>
        d.status === 'pending' &&
        d.patientId?.toString() === appointment.patient.toString() &&
        (
          d.appointmentId?.toString() === appointment._id.toString() ||
          (!d.appointmentId && (d.description || '').includes(appointment.reason || ''))
        )
      );
      for (const debt of relatedDebts) {
        debt.amount = 0;
        debt.status = 'paid';
        debt.paidAt = new Date();
      }
      if (relatedDebts.length > 0) {
        financial.markModified('debts');
        await financial.save();
      }
    }

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
      const ownerPaymentAlreadyRecorded = hasTransactionForAppointment(financial, appointment._id);
      if (totalPaying > 0 && !ownerPaymentAlreadyRecorded) {
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
        d.patientId?.toString() === patientId &&
        d.status === 'pending' &&
        (!d.appointmentId || d.appointmentId.toString() === appointment._id.toString())
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
        if (!hasTransactionForAppointment(doctorFinancial, appointment._id)) {
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
        }
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

    const labRequest = await LabRequest.findById(requestId)
      .populate('testIds', 'name price');

    if (!labRequest) {
      return res.status(404).json({ message: 'طلب الفحص غير موجود' });
    }

    if (labRequest.clinicId?.toString() !== clinic._id.toString()) {
      return res.status(403).json({ message: 'ليس لديك صلاحية على هذا الطلب' });
    }

    // Approve the lab request and forward to lab - no pricing here
    labRequest.approvalStatus = 'approved';
    labRequest.approvedBy = accountantId;
    labRequest.approvedAt = new Date();

    await labRequest.save();

    // No debt is created here - debt is added only when lab tech marks request as completed

    const populated = await LabRequest.findById(requestId)
      .populate('patientId', 'fullName mobileNumber')
      .populate('doctorId', 'fullName specialty')
      .populate('testIds', 'name price');

    res.status(200).json({ success: true, message: 'تم الموافقة على الطلب وتحويله للمختبر', labRequest: populated });
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
    if (email !== undefined) {
      // Store null (not "") to avoid unique index conflict on empty email
      updateData.email = email && email.trim() !== '' ? email.trim() : undefined;
      if (updateData.email === undefined) {
        // Unset the email field to avoid duplicate key on empty string
        updateData.$unset = { email: '' };
        delete updateData.email;
      }
    }
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

    // Separate $unset from regular updateData
    const unsetFields = updateData.$unset;
    if (unsetFields) delete updateData.$unset;

    const updateOp = { $set: updateData };
    if (unsetFields) updateOp.$unset = unsetFields;

    const patient = await User.findByIdAndUpdate(patientId, updateOp, { new: true })
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
// Supports: discount percentage + partial payment
// Example: debt=1000, discount=10% → net=900, patient pays 500 → remaining debt=400
exports.insertPayment = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const { patientId, amount, description, paymentMethod, date, discountPercent } = req.body;
    if (!patientId) {
      return res.status(400).json({ message: 'المريض مطلوب' });
    }

    const discountPct = Math.min(Math.max(Number(discountPercent) || 0, 0), 100);
    const clinicOwnerId = clinic.ownerId;

    // ====== Step 1: Gather ALL pending debts for this patient ======
    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
    }

    const patientDebts = financial.debts.filter(d =>
      d.patientId?.toString() === patientId && d.status === 'pending'
    );

    // Also gather debts from individual doctors' Financial records
    const doctorIdsForDebts = clinic.doctors?.filter(d => d.status === 'active').map(d => d.doctorId) || [];
    const doctorFinancials = await Financial.find({
      doctorId: { $in: doctorIdsForDebts },
      'debts.patientId': patientId,
      'debts.status': 'pending'
    });

    // Build a unified list of all debts
    const allDebts = [];
    for (const debt of patientDebts) {
      allDebts.push({ debt, source: 'clinic', financialDoc: financial, doctorId: debt.doctorId?.toString() || clinicOwnerId.toString() });
    }
    for (const docFin of doctorFinancials) {
      const docDebts = docFin.debts.filter(d =>
        d.patientId?.toString() === patientId && d.status === 'pending'
      );
      for (const debt of docDebts) {
        allDebts.push({ debt, source: 'doctor', financialDoc: docFin, doctorId: docFin.doctorId.toString() });
      }
    }

    // ====== Step 2: Calculate totals ======
    const totalDebt = allDebts.reduce((sum, item) => sum + item.debt.amount, 0);
    if (totalDebt <= 0) {
      return res.status(400).json({ message: 'لا يوجد دين معلق لهذا المريض' });
    }

    const discountAmount = Math.round(totalDebt * discountPct / 100 * 100) / 100;
    const netAfterDiscount = Math.round((totalDebt - discountAmount) * 100) / 100; // Max the patient needs to pay

    // paidAmount: what the patient actually pays now (can be partial)
    // If amount not provided or 0, default to full net amount
    let paidAmount = Number(amount) || 0;
    if (paidAmount <= 0) {
      paidAmount = netAfterDiscount; // Pay full net if no amount specified
    }
    // Cap paid amount to net after discount (can't pay more than what's owed after discount)
    paidAmount = Math.min(paidAmount, netAfterDiscount);
    paidAmount = Math.round(paidAmount * 100) / 100;

    // The total amount covered (paid + discount) out of original debt
    const totalCovered = paidAmount + discountAmount;
    // Remaining debt after this payment
    const newRemainingDebt = Math.round((totalDebt - totalCovered) * 100) / 100;

    // ====== Step 3: Process debts - FIFO, mark paid/partial based on coverage ======
    // Sort debts oldest first
    allDebts.sort((a, b) => new Date(a.debt.date) - new Date(b.debt.date));

    // Track how much each doctor gets from this payment (for revenue split)
    const doctorPaidAmounts = {}; // { doctorId: amountPaidForThisDoctor }
    const labPaidAmounts = {}; // { labRequestId: actualPaidAmount }
    const paidLabRequestIds = new Set();
    const fullyCoveredLabRequestIds = new Set();
    let coveragePool = totalCovered; // discount + paid amount to distribute across debts

    for (const item of allDebts) {
      if (coveragePool <= 0) break;
      const { debt, doctorId } = item;
      if (!debt.originalAmount) {
        debt.originalAmount = debt.amount;
      }
      const debtAmount = debt.amount;
      const covered = Math.min(coveragePool, debtAmount);
      coveragePool = Math.round((coveragePool - covered) * 100) / 100;

      if (covered >= debtAmount) {
        // Fully covered
        debt.amount = 0;
        debt.status = 'paid';
        debt.paidAt = new Date();
      } else {
        // Partially covered
        debt.amount = Math.round((debtAmount - covered) * 100) / 100;
      }

      // Track per-doctor: how much of the PAID amount (not discount) goes to this doctor
      // Proportional: (covered / totalCovered) * paidAmount
      if (totalCovered > 0) {
        const paidPortion = Math.round((covered / totalCovered) * paidAmount * 100) / 100;
        doctorPaidAmounts[doctorId] = (doctorPaidAmounts[doctorId] || 0) + paidPortion;

        if (debt.labRequestId && covered > 0) {
          const labRequestId = debt.labRequestId.toString();
          labPaidAmounts[labRequestId] = (labPaidAmounts[labRequestId] || 0) + paidPortion;
          paidLabRequestIds.add(labRequestId);
          if (debt.status === 'paid' || debt.amount <= 0) {
            fullyCoveredLabRequestIds.add(labRequestId);
          }
        }
      }
    }

    // Save clinic owner's financial
    financial.markModified('debts');
    await financial.save();

    // Save each doctor's financial (debts updated)
    for (const docFin of doctorFinancials) {
      docFin.markModified('debts');
      await docFin.save();
    }

    // Keep lab technician view in sync when accountant pays lab debts via "insert payment".
    for (const labRequestId of paidLabRequestIds) {
      const labPaidAmount = labPaidAmounts[labRequestId] || 0;
      const labRequest = await LabRequest.findById(labRequestId);
      if (!labRequest) continue;

      const currentPaid = Number(labRequest.paidAmount || 0);
      const nextPaid = Math.round((currentPaid + labPaidAmount) * 100) / 100;
      const totalCost = Number(labRequest.totalCost || labRequest.originalCost || 0);
      labRequest.paidAmount = totalCost > 0 ? Math.min(nextPaid, totalCost) : nextPaid;

      if (
        fullyCoveredLabRequestIds.has(labRequestId) ||
        (totalCost > 0 && labRequest.paidAmount >= totalCost)
      ) {
        labRequest.isPaid = true;
        labRequest.paidAt = labRequest.paidAt || new Date();
        labRequest.paidBy = accountantId;
      }

      await labRequest.save();
    }

    // ====== Step 4: Mark unpaid appointments as paid (up to coverage) ======
    const allDoctorIds = clinic.doctors?.filter(d => d.status === 'active').map(d => d.doctorId) || [];
    if (!allDoctorIds.some(id => id.toString() === clinicOwnerId.toString())) {
      allDoctorIds.push(clinicOwnerId);
    }
    const unpaidAppointments = await Appointment.find({
      patient: patientId,
      doctorId: { $in: allDoctorIds },
      isPaid: { $ne: true },
      status: { $in: ['confirmed', 'completed'] }
    }).sort({ appointmentDateTime: 1 });

    let aptCoveragePool = totalCovered;
    const paidAppointmentIds = [];
    for (const apt of unpaidAppointments) {
      if (aptCoveragePool <= 0) break;
      const totalAptFee = (apt.doctorFee || 0) + (apt.clinicFee || apt.appointmentFee || 0);
      const alreadyPaid = apt.paymentAmount || 0;
      const remaining = totalAptFee - alreadyPaid;
      if (remaining <= 0) {
        apt.isPaid = true;
        apt.paymentAmount = totalAptFee;
        apt.paidAt = new Date();
        apt.debt = 0;
        apt.debtStatus = 'none';
        await apt.save();
        paidAppointmentIds.push(apt._id);
        continue;
      }
      if (aptCoveragePool >= remaining) {
        aptCoveragePool -= remaining;
        apt.isPaid = true;
        apt.paymentAmount = totalAptFee;
        apt.paidAt = new Date();
        apt.debt = 0;
        apt.debtStatus = 'none';
        await apt.save();
        paidAppointmentIds.push(apt._id);
      } else {
        apt.paymentAmount = alreadyPaid + aptCoveragePool;
        apt.debt = totalAptFee - apt.paymentAmount;
        apt.debtStatus = 'partial';
        await apt.save();
        aptCoveragePool = 0;
      }
    }

    // ====== Step 5: Record the payment transaction on clinic owner's financial ======
    // Now that appointments are updated, add them to the transaction
    financial.transactions.push({
      amount: paidAmount,
      description: description || 'دفعة من مريض',
      date: date ? new Date(date) : new Date(),
      patientId,
      paymentMethod: paymentMethod || 'Cash',
      discount: discountAmount,
      discountPercent: discountPct,
      totalDebtBeforeDiscount: totalDebt,
      // Add appointment IDs that were paid through this transaction
      appointmentIds: paidAppointmentIds.map(id => id.toString()),
      labRequestId: paidLabRequestIds.size === 1 ? Array.from(paidLabRequestIds)[0] : undefined,
      labRequestIds: Array.from(paidLabRequestIds),
    });
    financial.totalEarnings += paidAmount;
    await financial.save();

    // ====== Step 6: Distribute paid amount proportionally to doctors ======
    for (const [docId, docPaidAmount] of Object.entries(doctorPaidAmounts)) {
      if (docId === clinicOwnerId.toString()) continue;
      if (docPaidAmount <= 0) continue;

      try {
        const doctorEntry = clinic.doctors.find(d => d.doctorId.toString() === docId);
        const clinicPercentage = doctorEntry?.clinicPercentage || 0;
        const doctorShare = Math.round(docPaidAmount * (100 - clinicPercentage) / 100 * 100) / 100;

        if (doctorShare > 0) {
          let doctorFinancial = await Financial.findOne({ doctorId: docId });
          if (!doctorFinancial) {
            doctorFinancial = new Financial({ doctorId: docId, totalEarnings: 0, totalExpenses: 0 });
          }

          const descParts = [];
          if (discountPct > 0) descParts.push(`خصم ${discountPct}%`);
          descParts.push(`نسبة المركز ${clinicPercentage}%`);

          doctorFinancial.transactions.push({
            amount: doctorShare,
            description: `حصة الطبيب من دفعة مريض - ${clinic.name} (${descParts.join(' | ')})`,
            date: new Date(),
            patientId,
            appointmentIds: paidAppointmentIds.map(id => id.toString()),
            paymentMethod: paymentMethod || 'Cash'
          });
          doctorFinancial.totalEarnings = (doctorFinancial.totalEarnings || 0) + doctorShare;

          // Clear matching debts on doctor's own financial (backward compat)
          const docOwnDebts = (doctorFinancial.debts || []).filter(d =>
            d.patientId?.toString() === patientId && d.status === 'pending'
          );
          for (const dd of docOwnDebts) {
            if (!dd.originalAmount) dd.originalAmount = dd.amount;
            dd.amount = 0;
            dd.status = 'paid';
            dd.paidAt = new Date();
          }

          doctorFinancial.markModified('debts');
          await doctorFinancial.save();
          console.log(`✅ Doctor ${docId}: paid portion ${docPaidAmount}, after clinic ${clinicPercentage}% = ${doctorShare}`);
        }
      } catch (docErr) {
        console.error('Error splitting payment to doctor:', docErr);
      }
    }

    // Also handle paid appointments for doctors who are not the clinic owner
    for (const apt of unpaidAppointments) {
      if (apt.isPaid && apt.doctorId.toString() !== clinicOwnerId.toString()) {
        try {
          const doctorFeeAmount = apt.doctorFee || 0;
          if (doctorFeeAmount > 0) {
            let doctorFinancial = await Financial.findOne({ doctorId: apt.doctorId });
            if (!doctorFinancial) {
              doctorFinancial = new Financial({ doctorId: apt.doctorId, totalEarnings: 0, totalExpenses: 0 });
            }
            const alreadyRecorded = doctorFinancial.transactions.some(t =>
              t.appointmentId?.toString() === apt._id.toString()
            );
            if (!alreadyRecorded) {
              const doctorEntry = clinic.doctors.find(d => d.doctorId.toString() === apt.doctorId.toString());
              const clinicPercentage = doctorEntry?.clinicPercentage || 0;
              const doctorShare = Math.round(doctorFeeAmount * (100 - clinicPercentage) / 100 * 100) / 100;

              if (doctorShare > 0) {
                const descParts = [];
                if (discountPct > 0) descParts.push(`خصم ${discountPct}%`);
                descParts.push(`نسبة المركز ${clinicPercentage}%`);
                doctorFinancial.transactions.push({
                  amount: doctorShare,
                  description: `حصة الطبيب من موعد مريض - ${clinic.name} (${descParts.join(' | ')})`,
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

    // ====== Step 7: Calculate remaining total debt for response ======
    const freshFinancial = await Financial.findOne({ doctorId: clinicOwnerId });
    const remainingDebt = (freshFinancial?.debts || [])
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
        totalDebt,
        netAfterDiscount,
        discountPercent: discountPct,
        discountAmount,
        amount: paidAmount,
        discount: discountAmount,
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

    // Get financial data for debts - clinic owner is the single source of truth
    const ownerFinancial = await Financial.findOne({ doctorId: clinicOwnerId });
    let debts = ownerFinancial?.debts || [];

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
      // Use Financial.debts as the primary source of truth
      const totalDebt = financialDebtTotal || (appointmentDebtMap[pid] || 0);
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

    // Clinic owner's Financial is the single source of truth for debts
    const financialObj = financial.toObject ? financial.toObject() : { ...financial };

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

    // Clinic owner's transactions are the income source of truth for editable payments.
    let transactionIncome = 0;
    const ownerTransactions = financial.transactions || [];
    for (const txn of ownerTransactions) {
      const txnDate = new Date(txn.date);
      if (txnDate >= startOfMonth && txnDate <= endOfMonth) {
        transactionIncome += txn.amount || 0;
      }
    }

    const totalMonthlyIncome = transactionIncome;

    // Build response - augment financial with computed income and merged debts
    const financialData = financial.toObject ? financial.toObject() : { ...financial };
    financialData.debts = financialObj.debts || []; // Use merged debts from all doctors
    financialData.totalEarnings = totalMonthlyIncome;
    financialData.totalExpenses = monthExpensesTotal;
    financialData.appointmentIncome = appointmentIncome;
    financialData.labIncome = labIncome;
    financialData.paymentIncome = transactionIncome;
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

    // Sync linked LabRequest if this debt is from a lab test
    let linkedLabRequestId = debt.labRequestId || null;
    try {
      let labReq = null;
      if (debt.labRequestId) {
        labReq = await LabRequest.findById(debt.labRequestId);
      }
      // Fallback: search by patient + description
      if (!labReq && debt.description && debt.description.includes('فحوصات مخبرية')) {
        labReq = await LabRequest.findOne({
          patientId: debt.patientId,
          status: 'completed',
          isPaid: false
        }).sort({ completedDate: -1 });
        // Link for future
        if (labReq) {
          debt.labRequestId = labReq._id;
          linkedLabRequestId = labReq._id;
          debtOwnerFinancial.markModified('debts');
          await debtOwnerFinancial.save();
        }
      }
      if (labReq) {
        const totalCost = Number(labReq.totalCost || labReq.originalCost || 0);
        const nextPaid = Math.round(((labReq.paidAmount || 0) + paymentAmount) * 100) / 100;
        labReq.paidAmount = totalCost > 0 ? Math.min(nextPaid, totalCost) : nextPaid;
        if (debt.status === 'paid') {
          labReq.isPaid = true;
          labReq.paidAt = new Date();
          labReq.paidBy = accountantId;
        }
        await labReq.save();
        linkedLabRequestId = labReq._id;
        console.log(`✅ Synced LabRequest ${labReq._id} on debt payment (paidAmount+${paymentAmount})`);
      }
    } catch (labErr) {
      console.error('Error syncing LabRequest on debt payment:', labErr);
    }

    // Add payment as a transaction on clinic owner's Financial
    financial.transactions.push({
      amount: paymentAmount,
      description: `دفع دين - ${debt.description || ''}`,
      date: new Date(),
      patientId: debt.patientId,
      labRequestId: linkedLabRequestId || undefined,
      labRequestIds: linkedLabRequestId ? [linkedLabRequestId] : [],
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

// Set lab clinic percentage
exports.setLabPercentage = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const { labPercentage } = req.body;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) return res.status(404).json({ message: 'لم يتم العثور على عيادة' });

    if (labPercentage === undefined || labPercentage === null) {
      return res.status(400).json({ message: 'يجب تحديد نسبة المختبر' });
    }
    const percentage = Number(labPercentage);
    if (isNaN(percentage) || percentage < 0 || percentage > 100) {
      return res.status(400).json({ message: 'النسبة يجب أن تكون بين 0 و 100' });
    }

    if (!clinic.settings) clinic.settings = {};
    clinic.settings.labPercentage = percentage;
    clinic.markModified('settings');
    await clinic.save();

    res.status(200).json({
      success: true,
      message: `تم تحديد نسبة العيادة من المختبر ${percentage}%`,
      labPercentage: percentage
    });
  } catch (error) {
    console.error('Error setting lab percentage:', error);
    res.status(500).json({ message: 'فشل في تحديد نسبة المختبر', error: error.message });
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

    res.status(200).json({ 
      success: true, 
      doctors: doctorsWithPercentages,
      labPercentage: clinic.settings?.labPercentage || 0
    });
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
            // Only unlinked treatment/debt-split transactions in the date range.
            if (isLinkedFinancialTransaction(txn)) continue;
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

    // Lab Revenue Calculation
    const labPercentage = clinic.settings?.labPercentage || 0;
    const completedLabRequests = await LabRequest.find({
      clinicId: clinic._id,
      status: 'completed',
      completedDate: { $gte: startDate, $lte: endDate }
    }).populate('patientId', 'fullName mobileNumber').populate('testIds', 'name price');

    const labTotalRevenue = completedLabRequests.reduce((sum, lr) => sum + (lr.totalCost || 0), 0);
    const labClinicShare = Math.round(labTotalRevenue * labPercentage / 100 * 100) / 100;
    const labNetRevenue = Math.round((labTotalRevenue - labClinicShare) * 100) / 100;
    const labPaidCount = completedLabRequests.filter(lr => lr.isPaid).length;
    const labPaidAmount = completedLabRequests.filter(lr => lr.isPaid).reduce((sum, lr) => sum + (lr.paidAmount || lr.totalCost || 0), 0);
    const labUnpaidAmount = labTotalRevenue - labPaidAmount;

    const labReport = {
      labPercentage,
      totalRequests: completedLabRequests.length,
      totalRevenue: labTotalRevenue,
      clinicShare: labClinicShare,
      labNetRevenue,
      paidCount: labPaidCount,
      unpaidCount: completedLabRequests.length - labPaidCount,
      paidAmount: Math.round(labPaidAmount * 100) / 100,
      unpaidAmount: Math.round(labUnpaidAmount * 100) / 100,
      requests: completedLabRequests.map(lr => ({
        _id: lr._id,
        date: lr.completedDate || lr.createdAt,
        patientName: lr.patientId?.fullName || 'غير معروف',
        patientMobile: lr.patientId?.mobileNumber || '',
        tests: (lr.testIds || []).map(t => t.name).join(', '),
        totalCost: lr.totalCost || 0,
        clinicShare: Math.round((lr.totalCost || 0) * labPercentage / 100 * 100) / 100,
        labShare: Math.round((lr.totalCost || 0) * (100 - labPercentage) / 100 * 100) / 100,
        isPaid: lr.isPaid || false,
        paidAmount: lr.paidAmount || 0
      }))
    };

    // Summary
    const totalAllFees = report.reduce((sum, r) => sum + r.totalFees, 0);
    const totalAllClinicShare = report.reduce((sum, r) => sum + r.totalClinicShare, 0);
    const totalAllDoctorShare = report.reduce((sum, r) => sum + r.totalDoctorShare, 0);
    const totalAllPaid = report.reduce((sum, r) => sum + r.totalPaidToDoctor, 0);
    const totalAllRemaining = report.reduce((sum, r) => sum + r.remainingForDoctor, 0);

    res.status(200).json({
      success: true,
      report,
      labReport,
      summary: {
        totalFees: totalAllFees,
        totalClinicShare: Math.round((totalAllClinicShare + labClinicShare) * 100) / 100,
        totalDoctorShare: Math.round(totalAllDoctorShare * 100) / 100,
        totalPaidToDoctors: Math.round(totalAllPaid * 100) / 100,
        totalRemainingForDoctors: Math.round(totalAllRemaining * 100) / 100,
        labTotalRevenue,
        labClinicShare,
        labNetRevenue,
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

// Edit a payment from the patient payments tab only.
exports.editPatientPayment = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const { patientId, transactionId } = req.params;
    const { amount, description, paymentMethod } = req.body;
    const newAmount = Number(amount);
    if (!newAmount || newAmount <= 0) {
      return res.status(400).json({ message: 'يجب إدخال مبلغ صالح' });
    }

    const clinicOwnerId = clinic.ownerId;
    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      return res.status(404).json({ message: 'لم يتم العثور على البيانات المالية' });
    }

    const transaction = financial.transactions.id(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'لم يتم العثور على الدفعة' });
    }
    if (transaction.patientId?.toString() !== patientId) {
      return res.status(403).json({ message: 'هذه الدفعة لا تخص هذا المريض' });
    }
    if (transaction.labRequestId || (transaction.labRequestIds && transaction.labRequestIds.length > 0) || transaction.orderId) {
      return res.status(400).json({ message: 'هذه الدفعة مرتبطة بعملية مركبة ولا يمكن تعديلها من هنا' });
    }

    const oldAmount = transaction.amount || 0;
    const diff = newAmount - oldAmount;

    transaction.amount = newAmount;
    if (description !== undefined) transaction.description = description;
    if (paymentMethod) transaction.paymentMethod = paymentMethod;
    transaction.lastEditedBy = accountantId;
    transaction.lastEditedAt = new Date();
    financial.totalEarnings = (financial.totalEarnings || 0) + diff;

    if (transaction.appointmentId) {
      const appointment = await Appointment.findById(transaction.appointmentId);
      if (appointment) {
        const totalFee = (appointment.doctorFee || 0) + (appointment.clinicFee || appointment.appointmentFee || 0);
        appointment.paymentAmount = newAmount;
        appointment.debt = Math.max(0, totalFee - newAmount);
        appointment.isPaid = appointment.debt <= 0;
        appointment.debtStatus = appointment.debt > 0 ? (newAmount > 0 ? 'partial' : 'full') : 'none';
        if (appointment.isPaid && !appointment.paidAt) appointment.paidAt = new Date();
        await appointment.save();
      }
    }

    if (transaction.appointmentIds && transaction.appointmentIds.length > 0) {
      const appointments = await Appointment.find({
        _id: { $in: transaction.appointmentIds }
      }).sort({ appointmentDateTime: 1 });

      let remainingPayment = newAmount + (transaction.discount || 0);
      for (const appointment of appointments) {
        const totalFee = (appointment.doctorFee || 0) + (appointment.clinicFee || appointment.appointmentFee || 0);
        const paidForAppointment = Math.max(0, Math.min(remainingPayment, totalFee));
        remainingPayment = Math.max(0, remainingPayment - paidForAppointment);
        const remainingDebt = Math.max(0, totalFee - paidForAppointment);

        appointment.paymentAmount = paidForAppointment;
        appointment.debt = remainingDebt;
        appointment.isPaid = remainingDebt <= 0;
        appointment.debtStatus = remainingDebt > 0 ? (paidForAppointment > 0 ? 'partial' : 'full') : 'none';
        if (appointment.isPaid && !appointment.paidAt) appointment.paidAt = new Date();
        await appointment.save();

        const existingDebt = (financial.debts || []).find((debt) =>
          debt.patientId?.toString() === patientId &&
          debt.appointmentId?.toString() === appointment._id.toString()
        );

        if (remainingDebt > 0) {
          if (existingDebt) {
            existingDebt.amount = remainingDebt;
            existingDebt.status = 'pending';
            existingDebt.paidAt = undefined;
          } else {
            financial.debts.push({
              patientId: appointment.patient,
              doctorId: appointment.doctorId,
              appointmentId: appointment._id,
              amount: remainingDebt,
              description: `دين موعد - ${appointment.reason || 'كشف'}`,
              date: new Date(),
              status: 'pending'
            });
          }
        } else if (existingDebt) {
          existingDebt.amount = 0;
          existingDebt.status = 'paid';
          existingDebt.paidAt = new Date();
        }
      }
      financial.markModified('debts');
    }

    financial.markModified('transactions');
    await financial.save();

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
    console.error('Error editing patient payment:', error);
    res.status(500).json({ message: 'فشل في تعديل الدفعة', error: error.message });
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
    const { amount, description, paymentMethod, discount, discountPercent, totalDebtBeforeDiscount } = req.body;
    const clinicOwnerId = clinic.ownerId;

    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      return res.status(404).json({ message: 'لم يتم العثور على البيانات المالية' });
    }

    const transaction = financial.transactions.id(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'لم يتم العثور على الدفعة' });
    }
    if (isProtectedFinancialTransaction(transaction)) {
      return res.status(400).json({
        message: 'لا يمكن تعديل دفعة مرتبطة بمريض أو موعد أو مختبر من هنا. استخدم شاشة الدين/الموعد المرتبطة حتى تبقى الحسابات متوازنة.'
      });
    }

    // Adjust totalEarnings based on amount change
    const oldAmount = transaction.amount;
    const newAmount = Number(amount);
    financial.totalEarnings = (financial.totalEarnings || 0) - oldAmount + newAmount;

    // Update transaction fields
    transaction.amount = newAmount;
    if (description !== undefined) transaction.description = description;
    if (paymentMethod) transaction.paymentMethod = paymentMethod;
    // Update discount fields
    if (discount !== undefined) transaction.discount = Number(discount) || 0;
    if (discountPercent !== undefined) transaction.discountPercent = Number(discountPercent) || 0;
    if (totalDebtBeforeDiscount !== undefined) transaction.totalDebtBeforeDiscount = Number(totalDebtBeforeDiscount) || 0;
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
    if (isProtectedFinancialTransaction(transaction)) {
      return res.status(400).json({
        message: 'لا يمكن حذف دفعة مرتبطة بمريض أو موعد أو مختبر من هنا. يجب عكس العملية من المصدر المرتبط.'
      });
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

// Get all invoices/payments for the clinic (الفواتير)
exports.getInvoices = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const clinicOwnerId = clinic.ownerId;
    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (!financial) {
      return res.status(200).json({ success: true, invoices: [] });
    }

    // Get all transactions (payments)
    const transactions = financial.transactions || [];
    if (transactions.length === 0) {
      return res.status(200).json({ success: true, invoices: [] });
    }

    // Get unique patient IDs from transactions
    const patientIds = [...new Set(transactions.filter(t => t.patientId).map(t => t.patientId.toString()))];
    const patients = await User.find({ _id: { $in: patientIds } }).select('fullName mobileNumber idNumber');
    const patientMap = {};
    patients.forEach(p => { patientMap[p._id.toString()] = p; });

    // Get unique appointment IDs
    const appointmentIds = [...new Set(transactions.filter(t => t.appointmentId).map(t => t.appointmentId.toString()))];
    const appointments = appointmentIds.length > 0 
      ? await Appointment.find({ _id: { $in: appointmentIds } }).populate('doctorId', 'fullName specialty')
      : [];
    const appointmentMap = {};
    appointments.forEach(a => { appointmentMap[a._id.toString()] = a; });

    // Get doctor IDs from clinic
    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
    const doctorsData = await User.find({ _id: { $in: doctorIds } }).select('fullName specialty');
    const doctorMap = {};
    doctorsData.forEach(d => { doctorMap[d._id.toString()] = d; });

    // Get editor names for audit trail
    const editorIds = [...new Set(transactions.filter(t => t.lastEditedBy).map(t => t.lastEditedBy.toString()))];
    const editors = editorIds.length > 0
      ? await User.find({ _id: { $in: editorIds } }).select('fullName')
      : [];
    const editorMap = {};
    editors.forEach(e => { editorMap[e._id.toString()] = e; });

    // Build invoices list sorted by date descending
    const invoices = transactions
      .map(t => {
        const patient = t.patientId ? patientMap[t.patientId.toString()] : null;
        const appointment = t.appointmentId ? appointmentMap[t.appointmentId.toString()] : null;
        const doctor = appointment?.doctorId || null;
        const editor = t.lastEditedBy ? editorMap[t.lastEditedBy.toString()] : null;

        return {
          _id: t._id,
          amount: t.amount,
          discount: t.discount || 0,
          discountPercent: t.discountPercent || 0,
          totalDebtBeforeDiscount: t.totalDebtBeforeDiscount || 0,
          description: t.description,
          date: t.date,
          paymentMethod: t.paymentMethod,
          patient: patient ? {
            _id: patient._id,
            fullName: patient.fullName,
            mobileNumber: patient.mobileNumber,
            idNumber: patient.idNumber
          } : null,
          doctor: doctor ? {
            _id: doctor._id,
            fullName: doctor.fullName,
            specialty: doctor.specialty
          } : null,
          appointmentId: t.appointmentId || null,
          appointmentIds: t.appointmentIds || [],
          labRequestId: t.labRequestId || null,
          labRequestIds: t.labRequestIds || [],
          isEditable: !isProtectedFinancialTransaction(t),
          invoiceNo: t._id.toString().slice(-8).toUpperCase(),
          isEdited: !!t.lastEditedBy,
          lastEditedBy: editor ? { _id: editor._id, fullName: editor.fullName } : null,
          lastEditedAt: t.lastEditedAt || null
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    res.status(200).json({
      success: true,
      invoices,
      totalAmount: invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0),
      totalDiscount: invoices.reduce((sum, inv) => sum + (inv.discount || 0), 0),
      totalCount: invoices.length
    });
  } catch (error) {
    console.error('Error getting invoices:', error);
    res.status(500).json({ message: 'فشل في جلب الفواتير', error: error.message });
  }
};

// ==================== DEBT MANAGEMENT ====================

// Edit a debt entry (change amount or description)
exports.editDebt = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) return res.status(404).json({ message: 'لم يتم العثور على عيادة' });

    const { debtId } = req.params;
    const { amount, description } = req.body;
    const clinicOwnerId = clinic.ownerId;

    // Search in clinic owner's financial first
    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    let debt = financial?.debts?.id(debtId);
    let targetFinancial = financial;

    // If not found, search in doctors' financials
    if (!debt) {
      const doctorIds = clinic.doctors?.filter(d => d.status === 'active').map(d => d.doctorId) || [];
      for (const docId of doctorIds) {
        const docFin = await Financial.findOne({ doctorId: docId });
        if (docFin) {
          const found = docFin.debts.id(debtId);
          if (found) {
            debt = found;
            targetFinancial = docFin;
            break;
          }
        }
      }
    }

    if (!debt) return res.status(404).json({ message: 'الدين غير موجود' });

    // Save original amount for reference
    if (!debt.originalAmount) {
      debt.originalAmount = debt.amount;
    }

    if (amount !== undefined && amount !== null) {
      const newAmount = Number(amount);
      if (isNaN(newAmount) || newAmount < 0) {
        return res.status(400).json({ message: 'المبلغ غير صالح' });
      }
      debt.amount = newAmount;
      if (newAmount === 0) {
        debt.status = 'paid';
        debt.paidAt = new Date();
      }
    }
    if (description !== undefined) {
      debt.description = description;
    }

    targetFinancial.markModified('debts');
    await targetFinancial.save();

    // Sync linked LabRequest if this debt is from a lab test
    try {
      let labReq = null;
      if (debt.labRequestId) {
        labReq = await LabRequest.findById(debt.labRequestId);
      }
      // Fallback: search by patient + description containing 'فحوصات مخبرية'
      if (!labReq && debt.description && debt.description.includes('فحوصات مخبرية')) {
        labReq = await LabRequest.findOne({
          patientId: debt.patientId,
          status: 'completed',
          totalCost: debt.originalAmount || { $gt: 0 }
        }).sort({ completedDate: -1 });
        // Link for future syncs
        if (labReq) {
          debt.labRequestId = labReq._id;
          targetFinancial.markModified('debts');
          await targetFinancial.save();
        }
      }
      if (labReq) {
        if (debt.status === 'paid') {
          labReq.isPaid = true;
          labReq.paidAmount = labReq.totalCost || labReq.originalCost || debt.originalAmount || debt.amount;
          labReq.paidAt = new Date();
        } else if (!labReq.paidAmount) {
          labReq.totalCost = debt.amount;
        }
        await labReq.save();
        console.log(`✅ Synced LabRequest ${labReq._id} on debt edit`);
      }
    } catch (labErr) {
      console.error('Error syncing LabRequest on debt edit:', labErr);
    }

    // Also sync the corresponding appointment's debt field if possible
    if (debt.patientId) {
      const doctorIds = clinic.doctors?.filter(d => d.status === 'active').map(d => d.doctorId) || [];
      const relatedApts = await Appointment.find({
        patient: debt.patientId,
        doctorId: { $in: doctorIds },
        isPaid: false,
        status: { $in: ['confirmed', 'completed'] }
      }).sort({ appointmentDateTime: 1 });

      // Recalculate appointment debts from Financial.debts
      const allPendingDebts = (targetFinancial.debts || [])
        .filter(d => d.patientId?.toString() === debt.patientId.toString() && d.status === 'pending');
      const totalPendingDebt = allPendingDebts.reduce((s, d) => s + d.amount, 0);

      // Distribute total pending debt across unpaid appointments
      let remainingDebt = totalPendingDebt;
      for (const apt of relatedApts) {
        const aptTotal = (apt.doctorFee || 0) + (apt.clinicFee || apt.appointmentFee || 0);
        const aptPaid = apt.paymentAmount || 0;
        const aptOwes = aptTotal - aptPaid;
        if (aptOwes <= 0) {
          apt.debt = 0;
          apt.debtStatus = 'none';
          apt.isPaid = true;
          await apt.save();
          continue;
        }
        if (remainingDebt >= aptOwes) {
          apt.debt = aptOwes;
          apt.debtStatus = aptPaid > 0 ? 'partial' : 'full';
          remainingDebt -= aptOwes;
        } else if (remainingDebt > 0) {
          apt.debt = remainingDebt;
          apt.debtStatus = 'partial';
          remainingDebt = 0;
        } else {
          apt.debt = 0;
          apt.debtStatus = 'none';
          apt.isPaid = true;
        }
        await apt.save();
      }
    }

    res.status(200).json({ success: true, message: 'تم تعديل الدين بنجاح' });
  } catch (error) {
    console.error('Error editing debt:', error);
    res.status(500).json({ message: 'فشل في تعديل الدين', error: error.message });
  }
};

// Delete a debt entry completely
exports.deleteDebt = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) return res.status(404).json({ message: 'لم يتم العثور على عيادة' });

    const { debtId } = req.params;
    const clinicOwnerId = clinic.ownerId;

    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    let debt = financial?.debts?.id(debtId);
    let targetFinancial = financial;

    if (!debt) {
      const doctorIds = clinic.doctors?.filter(d => d.status === 'active').map(d => d.doctorId) || [];
      for (const docId of doctorIds) {
        const docFin = await Financial.findOne({ doctorId: docId });
        if (docFin) {
          const found = docFin.debts.id(debtId);
          if (found) {
            debt = found;
            targetFinancial = docFin;
            break;
          }
        }
      }
    }

    if (!debt) return res.status(404).json({ message: 'الدين غير موجود' });

    const patientId = debt.patientId?.toString();
    const linkedLabRequestId = debt.labRequestId;
    const debtDescription = debt.description;
    const debtOriginalAmount = debt.originalAmount;

    targetFinancial.debts.pull(debtId);
    await targetFinancial.save();

    // Sync linked LabRequest if this debt was from a lab test
    try {
      let labReq = null;
      if (linkedLabRequestId) {
        labReq = await LabRequest.findById(linkedLabRequestId);
      }
      // Fallback: search by patient + description
      if (!labReq && debtDescription && debtDescription.includes('فحوصات مخبرية') && patientId) {
        labReq = await LabRequest.findOne({
          patientId,
          status: 'completed',
          totalCost: debtOriginalAmount || { $gt: 0 }
        }).sort({ completedDate: -1 });
      }
      if (labReq) {
        labReq.totalCost = 0;
        labReq.isPaid = true;
        labReq.paidAmount = labReq.originalCost || 0;
        labReq.paidAt = new Date();
        await labReq.save();
        console.log(`✅ Synced LabRequest ${labReq._id} on debt delete (totalCost=0)`);
      }
    } catch (labErr) {
      console.error('Error syncing LabRequest on debt delete:', labErr);
    }

    // Also clear debt from related unpaid appointments
    if (patientId) {
      const doctorIds = clinic.doctors?.filter(d => d.status === 'active').map(d => d.doctorId) || [];
      // Recalculate remaining debts for this patient
      const allFinancials = await Financial.find({ doctorId: { $in: [clinicOwnerId, ...doctorIds] } });
      let totalRemainingDebt = 0;
      for (const fin of allFinancials) {
        totalRemainingDebt += (fin.debts || [])
          .filter(d => d.patientId?.toString() === patientId && d.status === 'pending')
          .reduce((s, d) => s + d.amount, 0);
      }

      // If no more pending debts, mark all unpaid appointments as paid
      if (totalRemainingDebt <= 0) {
        await Appointment.updateMany(
          { patient: patientId, doctorId: { $in: doctorIds }, isPaid: false, status: { $in: ['confirmed', 'completed'] } },
          { $set: { debt: 0, debtStatus: 'none', isPaid: true } }
        );
      }
    }

    res.status(200).json({ success: true, message: 'تم حذف الدين بنجاح' });
  } catch (error) {
    console.error('Error deleting debt:', error);
    res.status(500).json({ message: 'فشل في حذف الدين', error: error.message });
  }
};

// ==================== EDIT APPOINTMENT FINANCIALS ====================

// Edit appointment financial fields (fee, debt, payment)
exports.editAppointmentFinancials = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) return res.status(404).json({ message: 'لم يتم العثور على عيادة' });

    const { appointmentId } = req.params;
    const { appointmentFee, clinicFee, doctorFee, paymentAmount, isPaid, debt } = req.body;

    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId.toString());
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) return res.status(404).json({ message: 'الموعد غير موجود' });
    if (!doctorIds.includes(appointment.doctorId.toString())) {
      return res.status(403).json({ message: 'الموعد ليس لطبيب في هذه العيادة' });
    }

    // Track old values for financial adjustments
    const oldPaymentAmount = appointment.paymentAmount || 0;

    // Update fields that are provided
    if (appointmentFee !== undefined) appointment.appointmentFee = Number(appointmentFee);
    if (clinicFee !== undefined) appointment.clinicFee = Number(clinicFee);
    if (doctorFee !== undefined) appointment.doctorFee = Number(doctorFee);
    if (paymentAmount !== undefined) appointment.paymentAmount = Number(paymentAmount);

    // Recalculate debt
    const totalFee = (appointment.doctorFee || 0) + (appointment.clinicFee || appointment.appointmentFee || 0);
    const paid = appointment.paymentAmount || 0;
    const remaining = Math.max(0, totalFee - paid);

    if (isPaid !== undefined) {
      appointment.isPaid = isPaid;
    } else {
      appointment.isPaid = remaining <= 0;
    }

    if (debt !== undefined) {
      appointment.debt = Number(debt);
    } else {
      appointment.debt = remaining;
    }

    appointment.debtStatus = appointment.debt > 0 ? (paid > 0 ? 'partial' : 'full') : 'none';
    if (appointment.isPaid && !appointment.paidAt) {
      appointment.paidAt = new Date();
    }

    await appointment.save();

    // Sync Financial.debts for this patient
    const clinicOwnerId = clinic.ownerId;
    let financial = await Financial.findOne({ doctorId: clinicOwnerId });
    if (financial) {
      const patientId = appointment.patient.toString();
      // Find existing pending debts for this patient
      const patientDebts = financial.debts.filter(d =>
        d.patientId?.toString() === patientId && d.status === 'pending'
      );

      if (remaining > 0) {
        if (patientDebts.length > 0) {
          // Update the first pending debt to match
          patientDebts[0].amount = remaining;
          // Mark extras as paid
          for (let i = 1; i < patientDebts.length; i++) {
            patientDebts[i].amount = 0;
            patientDebts[i].status = 'paid';
            patientDebts[i].paidAt = new Date();
          }
        } else {
          // No pending debt exists, create one
          financial.debts.push({
            patientId: appointment.patient,
            doctorId: appointment.doctorId,
            amount: remaining,
            description: `دين موعد - ${appointment.reason || 'كشف'}`,
            date: new Date(),
            status: 'pending'
          });
        }
      } else {
        // No remaining debt — mark all patient debts as paid
        for (const d of patientDebts) {
          d.amount = 0;
          d.status = 'paid';
          d.paidAt = new Date();
        }
      }

      // Adjust totalEarnings if payment changed
      const paymentDiff = (appointment.paymentAmount || 0) - oldPaymentAmount;
      if (paymentDiff !== 0) {
        financial.totalEarnings = (financial.totalEarnings || 0) + paymentDiff;
      }

      financial.markModified('debts');
      await financial.save();
    }

    const populatedAppointment = await Appointment.findById(appointmentId)
      .populate('patient', 'fullName mobileNumber')
      .populate('doctorId', 'fullName specialty');

    res.status(200).json({
      success: true,
      message: 'تم تعديل البيانات المالية للموعد بنجاح',
      appointment: populatedAppointment
    });
  } catch (error) {
    console.error('Error editing appointment financials:', error);
    res.status(500).json({ message: 'فشل في تعديل البيانات المالية', error: error.message });
  }
};

// ==================== DELETE PATIENT ====================

// Delete a patient permanently from the clinic
exports.deletePatient = async (req, res) => {
  try {
    const accountantId = req.user._id;
    const clinic = await getClinicForAccountant(accountantId);
    if (!clinic) return res.status(404).json({ message: 'لم يتم العثور على عيادة' });

    const { patientId } = req.params;

    // Verify patient belongs to this clinic's doctors
    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
    const doctors = await User.find({ _id: { $in: doctorIds } });
    let patientFound = false;
    for (const doc of doctors) {
      if ((doc.patients || []).map(String).includes(patientId)) {
        patientFound = true;
        break;
      }
    }

    if (!patientFound) {
      return res.status(404).json({ message: 'المريض غير موجود في هذه العيادة' });
    }

    // Check for unpaid debts
    const clinicOwnerId = clinic.ownerId;
    const financial = await Financial.findOne({ doctorId: clinicOwnerId });
    const pendingDebts = (financial?.debts || []).filter(d =>
      d.patientId?.toString() === patientId && d.status === 'pending'
    );
    const totalPendingDebt = pendingDebts.reduce((s, d) => s + d.amount, 0);

    if (totalPendingDebt > 0) {
      return res.status(400).json({
        message: `لا يمكن حذف المريض - عليه دين معلق بقيمة ₪${totalPendingDebt}. يجب تسوية الدين أولاً أو حذفه.`,
        pendingDebt: totalPendingDebt
      });
    }

    // 1. Remove patient from all clinic doctors' patient lists
    for (const doc of doctors) {
      const idx = (doc.patients || []).map(String).indexOf(patientId);
      if (idx !== -1) {
        doc.patients.splice(idx, 1);
        await doc.save({ validateBeforeSave: false });
      }
    }

    // 2. Cancel all future appointments
    const now = new Date();
    await Appointment.updateMany(
      {
        patient: patientId,
        doctorId: { $in: doctorIds },
        appointmentDateTime: { $gte: now },
        status: { $in: ['pending', 'confirmed'] }
      },
      { $set: { status: 'cancelled', isPaid: true, debt: 0, debtStatus: 'none' } }
    );

    // 3. Clean up Financial.debts (mark all as paid/removed)
    if (financial) {
      const patientFinDebts = financial.debts.filter(d =>
        d.patientId?.toString() === patientId
      );
      for (const d of patientFinDebts) {
        if (d.status === 'pending') {
          d.status = 'paid';
          d.amount = 0;
          d.paidAt = new Date();
        }
      }
      financial.markModified('debts');
      await financial.save();
    }

    // 4. Delete the patient User account entirely
    await User.findByIdAndDelete(patientId);

    // 5. Delete related medical records
    const MedicalRecord = require('../models/MedicalRecord');
    await MedicalRecord.deleteMany({ patient: patientId });

    // 6. Delete related lab requests
    const LabRequest = require('../models/LabRequest');
    await LabRequest.deleteMany({ patientId: patientId });

    res.status(200).json({
      success: true,
      message: 'تم حذف المريض نهائياً من العيادة'
    });
  } catch (error) {
    console.error('Error deleting patient:', error);
    res.status(500).json({ message: 'فشل في حذف المريض', error: error.message });
  }
};
