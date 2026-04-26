const LabRequest = require('../models/LabRequest');
const MedicalTest = require('../models/MedicalTest');
const User = require('../models/User');
const Clinic = require('../models/Clinic');
const Financial = require('../models/Financial');
const bcrypt = require('bcryptjs');

// Get clinic for this lab tech
const getClinicForLabTech = async (labTechId) => {
  const clinic = await Clinic.findOne({
    'staff.userId': labTechId,
    'staff.role': 'LabTech',
    'staff.status': 'active'
  });
  return clinic;
};

// Get all lab tech IDs in the same clinic
const getAllLabTechIdsInClinic = (clinic) => {
  if (!clinic) return [];
  return clinic.staff
    .filter(s => s.role === 'LabTech' && s.status === 'active')
    .map(s => s.userId);
};

// Get dashboard stats
exports.getDashboardStats = async (req, res) => {
  try {
    const labTechId = req.user._id;
    const clinic = await getClinicForLabTech(labTechId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    // Get requests where lab is this user or clinic-wide (all lab techs in same clinic)
    const queryFilter = { labId: labTechId };
    if (clinic) {
      const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
      const allLabTechIds = getAllLabTechIdsInClinic(clinic);
      queryFilter.$or = [
        { labId: { $in: allLabTechIds } },
        { doctorId: { $in: doctorIds } }
      ];
      delete queryFilter.labId;
    }

    const [pendingCount, inProgressCount, completedThisMonth, todayRequests] = await Promise.all([
      LabRequest.countDocuments({ ...queryFilter, status: 'pending' }),
      LabRequest.countDocuments({ ...queryFilter, status: { $in: ['in_progress', 'in-progress'] } }),
      LabRequest.countDocuments({ ...queryFilter, status: 'completed', completedDate: { $gte: monthStart } }),
      LabRequest.countDocuments({ ...queryFilter, requestDate: { $gte: today, $lt: tomorrow } }),
    ]);

    const testCount = await MedicalTest.countDocuments({ isActive: true });

    // Fetch clinic owner info for report header
    let clinicOwnerInfo = {};
    if (clinic) {
      const owner = await User.findById(clinic.ownerId).select('fullName mobileNumber address email');
      if (owner) {
        clinicOwnerInfo = {
          ownerName: owner.fullName || '',
          clinicPhone: owner.mobileNumber || '',
          clinicAddress: owner.address || '',
          clinicEmail: owner.email || '',
        };
      }
    }

    // Revenue calculations from completed lab requests
    const [monthlyRevenueResult, totalRevenueResult, paidMonthlyResult, paidTotalResult] = await Promise.all([
      // Monthly revenue (completed this month)
      LabRequest.aggregate([
        { $match: { ...queryFilter, status: 'completed', completedDate: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$totalCost' }, count: { $sum: 1 } } }
      ]),
      // Total revenue (all completed)
      LabRequest.aggregate([
        { $match: { ...queryFilter, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$totalCost' }, count: { $sum: 1 } } }
      ]),
      // Monthly paid amount
      LabRequest.aggregate([
        { $match: { ...queryFilter, status: 'completed', isPaid: true, completedDate: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$paidAmount' } } }
      ]),
      // Total paid amount
      LabRequest.aggregate([
        { $match: { ...queryFilter, status: 'completed', isPaid: true } },
        { $group: { _id: null, total: { $sum: '$paidAmount' } } }
      ]),
    ]);

    const monthlyRevenue = monthlyRevenueResult[0]?.total || 0;
    const totalRevenue = totalRevenueResult[0]?.total || 0;
    const monthlyPaid = paidMonthlyResult[0]?.total || 0;
    const totalPaid = paidTotalResult[0]?.total || 0;
    const monthlyUnpaid = monthlyRevenue - monthlyPaid;
    const totalUnpaid = totalRevenue - totalPaid;

    res.status(200).json({
      success: true,
      stats: {
        pendingRequests: pendingCount,
        inProgressRequests: inProgressCount,
        completedRequests: completedThisMonth,
        todayRequests,
        totalTests: testCount,
        clinicName: clinic?.name || '',
        ...clinicOwnerInfo,
        // Revenue data
        monthlyRevenue,
        totalRevenue,
        monthlyPaid,
        totalPaid,
        monthlyUnpaid,
        totalUnpaid,
      }
    });
  } catch (error) {
    console.error('Error fetching lab tech stats:', error);
    res.status(500).json({ message: 'فشل في جلب الإحصائيات', error: error.message });
  }
};

// Get all lab requests
exports.getRequests = async (req, res) => {
  try {
    const labTechId = req.user._id;
    const clinic = await getClinicForLabTech(labTechId);
    const { status, page = 1, limit = 20 } = req.query;

    let queryFilter = { labId: labTechId, approvalStatus: { $ne: 'pending_approval' } };
    if (clinic) {
      const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
      const allLabTechIds = getAllLabTechIdsInClinic(clinic);
      queryFilter = {
        $or: [
          { labId: { $in: allLabTechIds } },
          { doctorId: { $in: doctorIds } }
        ],
        // Only show approved requests (not pending accountant approval)
        approvalStatus: { $in: ['approved', null] }
      };
    }

    if (status && status !== 'all') {
      queryFilter.status = status;
    }

    const requests = await LabRequest.find(queryFilter)
      .populate('patientId', 'fullName mobileNumber profileImage birthdate sex')
      .populate('doctorId', 'fullName specialty')
      .populate('testIds', 'name type category price normalRange unit')
      .populate('requestedBy', 'fullName')
      .sort({ requestDate: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await LabRequest.countDocuments(queryFilter);

    res.status(200).json({
      success: true,
      requests,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (error) {
    console.error('Error fetching lab requests:', error);
    res.status(500).json({ message: 'فشل في جلب طلبات الفحوصات', error: error.message });
  }
};

// Update lab request status and results
exports.updateRequest = async (req, res) => {
  try {
    const labTechId = req.user._id;
    const { requestId } = req.params;
    const { status, results, notes, testUpdates, testPrices, discount } = req.body;

    const request = await LabRequest.findById(requestId).populate('testIds', 'name price');
    if (!request) {
      return res.status(404).json({ message: 'طلب الفحص غير موجود' });
    }

    const wasAlreadyCompleted = request.status === 'completed';

    if (status) request.status = status;
    if (notes !== undefined) request.notes = notes;
    if (results) {
      // results should be an array of { testId, result, normalRange, unit, isNormal, notes }
      if (Array.isArray(results)) {
        request.results = results;
      } else if (typeof results === 'string' && results.trim()) {
        // Fallback: wrap plain string into a result entry for the first test
        const firstTestId = request.testIds?.[0];
        request.results = [{ testId: firstTestId, result: results.trim(), isNormal: true }];
      }
    }
    if (status === 'completed') request.completedDate = new Date();

    // When lab tech marks as completed, set pricing and create debt
    // Only add/update debt on FIRST completion (not on subsequent edits)
    if (status === 'completed') {
      // testPrices is an optional object: { testId: customPrice, ... }
      // If not provided, use default prices from MedicalTest
      const pricesMap = testPrices || {};
      let originalCost = 0;
      (request.testIds || []).forEach(test => {
        const testId = test._id?.toString() || test.toString();
        const price = pricesMap[testId] !== undefined ? Number(pricesMap[testId]) : (test.price || 0);
        originalCost += price;
      });

      const discountPercent = Math.min(Math.max(Number(discount) || 0, 0), 100);
      const discountAmount = Math.round(originalCost * discountPercent / 100 * 100) / 100;
      const totalCost = Math.round((originalCost - discountAmount) * 100) / 100;

      request.originalCost = originalCost;
      request.discount = discountPercent;
      request.discountAmount = discountAmount;
      request.totalCost = totalCost;

      // Add lab test cost as DEBT to the patient in CLINIC OWNER's Financial
      // Only create/update debt on FIRST completion - skip if already was completed
      if (totalCost > 0 && !wasAlreadyCompleted) {
        try {
          const clinic = await getClinicForLabTech(labTechId);
          if (clinic) {
            const clinicOwnerId = clinic.ownerId;
            let financial = await Financial.findOne({ doctorId: clinicOwnerId });
            if (!financial) {
              financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
            }
            const testNames = (request.testIds || []).map(t => t.name).join(', ');
            const debtDescription = discountPercent > 0
              ? `فحوصات مخبرية (${testNames}) - خصم ${discountPercent}%`
              : `فحوصات مخبرية - ${testNames}`;

            // Check if debt for this lab request already exists (avoid duplicates on re-save)
            const existingDebt = financial.debts.find(d =>
              d.labRequestId && d.labRequestId.toString() === request._id.toString() && d.status === 'pending'
            );

            if (existingDebt) {
              // Update existing debt amount and description
              existingDebt.amount = totalCost;
              existingDebt.originalAmount = originalCost;
              existingDebt.description = debtDescription;
              financial.markModified('debts');
            } else {
              financial.debts.push({
                patientId: request.patientId,
                doctorId: request.doctorId,
                labRequestId: request._id,
                amount: totalCost,
                originalAmount: originalCost,
                description: debtDescription,
                date: new Date(),
                status: 'pending'
              });
            }
            await financial.save();
            console.log(`Lab tech ${existingDebt ? 'updated' : 'added'} lab test debt of ${totalCost} ILS for patient ${request.patientId}`);
          }
        } catch (debtErr) {
          console.error('Error adding lab test debt from lab tech:', debtErr);
        }
      }
    }

    await request.save();

    // Persist normalRange/unit to MedicalTest documents if provided
    if (Array.isArray(testUpdates) && testUpdates.length > 0) {
      const bulkOps = testUpdates
        .filter(tu => tu.testId && (tu.normalRange || tu.unit))
        .map(tu => ({
          updateOne: {
            filter: { _id: tu.testId },
            update: {
              $set: {
                ...(tu.normalRange ? { normalRange: tu.normalRange } : {}),
                ...(tu.unit ? { unit: tu.unit } : {}),
              }
            }
          }
        }));
      if (bulkOps.length > 0) {
        await MedicalTest.bulkWrite(bulkOps);
      }
    }

    const updatedRequest = await LabRequest.findById(requestId)
      .populate('patientId', 'fullName mobileNumber profileImage birthdate sex')
      .populate('doctorId', 'fullName specialty')
      .populate('testIds', 'name type category price normalRange unit')
      .populate('requestedBy', 'fullName');

    res.status(200).json({
      success: true,
      message: 'تم تحديث طلب الفحص بنجاح',
      request: updatedRequest
    });
  } catch (error) {
    console.error('Error updating lab request:', error);
    res.status(500).json({ message: 'فشل في تحديث طلب الفحص', error: error.message });
  }
};

// ==================== MEDICAL TESTS MANAGEMENT ====================

// Get all medical tests
exports.getTests = async (req, res) => {
  try {
    const { search, type, category, page = 1, limit = 50 } = req.query;

    let filter = { isActive: true };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }
    if (type) filter.type = type;
    if (category) filter.category = category;

    const tests = await MedicalTest.find(filter)
      .sort({ name: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await MedicalTest.countDocuments(filter);

    res.status(200).json({
      success: true,
      tests,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (error) {
    console.error('Error fetching tests:', error);
    res.status(500).json({ message: 'فشل في جلب الفحوصات', error: error.message });
  }
};

// Create a new test
exports.createTest = async (req, res) => {
  try {
    const labTechId = req.user._id;
    const { name, type, category, description, normalRange, unit, price, preparationInstructions, estimatedDuration } = req.body;

    if (!name || !type || !category) {
      return res.status(400).json({ message: 'الاسم، النوع، والفئة مطلوبة' });
    }

    const existingTest = await MedicalTest.findOne({
      name: { $regex: new RegExp('^' + name + '$', 'i') }
    });
    if (existingTest) {
      return res.status(400).json({ message: 'فحص بهذا الاسم موجود بالفعل' });
    }

    const clinic = await getClinicForLabTech(labTechId);

    const test = new MedicalTest({
      name,
      type,
      category,
      description,
      normalRange,
      unit,
      price: price || 0,
      preparationInstructions,
      estimatedDuration,
      clinicId: clinic?._id || null,
      createdBy: labTechId
    });

    await test.save();

    res.status(201).json({
      success: true,
      message: 'تم إنشاء الفحص بنجاح',
      test
    });
  } catch (error) {
    console.error('Error creating test:', error);
    res.status(500).json({ message: 'فشل في إنشاء الفحص', error: error.message });
  }
};

// Update a test
exports.updateTest = async (req, res) => {
  try {
    const { testId } = req.params;
    const updates = req.body;

    const test = await MedicalTest.findById(testId);
    if (!test) {
      return res.status(404).json({ message: 'الفحص غير موجود' });
    }

    const allowedFields = ['name', 'type', 'category', 'description', 'normalRange', 'unit', 'price', 'preparationInstructions', 'estimatedDuration'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        test[field] = updates[field];
      }
    }

    await test.save();

    res.status(200).json({
      success: true,
      message: 'تم تحديث الفحص بنجاح',
      test
    });
  } catch (error) {
    console.error('Error updating test:', error);
    res.status(500).json({ message: 'فشل في تحديث الفحص', error: error.message });
  }
};

// Delete (deactivate) a test
exports.deleteTest = async (req, res) => {
  try {
    const { testId } = req.params;

    const test = await MedicalTest.findById(testId);
    if (!test) {
      return res.status(404).json({ message: 'الفحص غير موجود' });
    }

    test.isActive = false;
    await test.save();

    res.status(200).json({
      success: true,
      message: 'تم حذف الفحص بنجاح'
    });
  } catch (error) {
    console.error('Error deleting test:', error);
    res.status(500).json({ message: 'فشل في حذف الفحص', error: error.message });
  }
};

// Get all patients in the lab tech's clinic
exports.getPatients = async (req, res) => {
  try {
    const labTechId = req.user._id;
    const clinic = await getClinicForLabTech(labTechId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const doctorIds = clinic.doctors
      .filter(d => d.status === 'active')
      .map(d => d.doctorId);

    const doctors = await User.find({ _id: { $in: doctorIds } })
      .populate('patients', 'fullName email mobileNumber profileImage city address birthdate sex');

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
    console.error('Error fetching lab tech patients:', error);
    res.status(500).json({ message: 'فشل في جلب قائمة المرضى', error: error.message });
  }
};

// Get full patient details (for medical history view)
exports.getPatientDetails = async (req, res) => {
  try {
    const labTechId = req.user._id;
    const clinic = await getClinicForLabTech(labTechId);
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
    console.error('Error fetching patient details:', error);
    res.status(500).json({ message: 'فشل في جلب بيانات المريض', error: error.message });
  }
};

// Register a new patient (same as accountant)
exports.registerPatient = async (req, res) => {
  try {
    const labTechId = req.user._id;
    const clinic = await getClinicForLabTech(labTechId);
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

    // Verify doctor is in the clinic if specified
    if (doctorId) {
      const doctorEntry = clinic.doctors.find(d =>
        d.doctorId.toString() === doctorId && d.status === 'active'
      );
      if (!doctorEntry) {
        return res.status(403).json({ message: 'الطبيب غير موجود في هذه العيادة' });
      }
    }

    // Check if patient exists
    let patient = await User.findOne({ mobileNumber });
    if (!patient) {
      patient = await User.findOne({ idNumber });
    }

    if (patient) {
      // Patient exists — update medical fields
      const medicalFields = {
        maritalStatus, emergencyContactName, emergencyContactRelation, emergencyPhone,
        hasChronicDiseases, chronicDiseasesText, hasSurgeries, surgeriesText,
        hasFamilyDiseases, familyDiseasesText, hasDrugAllergies, drugAllergiesText,
        hasFoodAllergies, foodAllergiesText, bloodPressure, heartRate, temperature, bloodSugar,
        smoking, previousDiseases, disabilities
      };
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

      // Add to doctor(s)
      if (doctorId) {
        const doctor = await User.findById(doctorId);
        if (doctor && !doctor.patients.includes(patient._id)) {
          doctor.patients.push(patient._id);
          await doctor.save({ validateBeforeSave: false });
        }
      } else {
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
        patient: { _id: patient._id, fullName: patient.fullName, mobileNumber: patient.mobileNumber, idNumber: patient.idNumber },
        isExisting: true
      });
    }

    // Create new patient
    const clinicOwner = await User.findById(clinic.ownerId);
    const hashedPassword = await bcrypt.hash(password || mobileNumber, 10);

    const newPatient = new User({
      fullName, mobileNumber, idNumber,
      password: hashedPassword,
      role: 'User',
      birthdate, sex,
      address: address || clinicOwner?.address || '',
      country: country || clinicOwner?.country || 'Palestine',
      city: city || clinicOwner?.city || '',
      isPhoneVerified: true,
      activationStatus: 'active',
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
      patient: { _id: newPatient._id, fullName: newPatient.fullName, mobileNumber: newPatient.mobileNumber, idNumber: newPatient.idNumber },
      isExisting: false
    });
  } catch (error) {
    console.error('Error registering patient (lab tech):', error);
    res.status(500).json({ message: 'فشل في تسجيل المريض', error: error.message });
  }
};

// Get clinic doctors (for lab tech)
exports.getDoctors = async (req, res) => {
  try {
    const labTechId = req.user._id;
    const clinic = await getClinicForLabTech(labTechId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
    const doctors = await User.find({ _id: { $in: doctorIds } }).select('fullName specialty profileImage');

    // Add clinic itself as an option (for walk-in patients without a specific doctor)
    const clinicOption = {
      _id: clinic.ownerId,
      fullName: clinic.name,
      specialty: 'المستوصف',
      isClinic: true
    };

    res.status(200).json({ success: true, doctors: [clinicOption, ...doctors] });
  } catch (error) {
    console.error('Error fetching doctors for lab tech:', error);
    res.status(500).json({ message: 'فشل في جلب قائمة الأطباء', error: error.message });
  }
};

// Request lab test (lab tech initiated)
exports.requestLabTest = async (req, res) => {
  try {
    const labTechId = req.user._id;
    const clinic = await getClinicForLabTech(labTechId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة' });
    }

    const { patientId, doctorId, testIds, notes, discount } = req.body;

    if (!patientId || !testIds || testIds.length === 0) {
      return res.status(400).json({ message: 'يجب تحديد المريض والفحوصات المطلوبة' });
    }

    // Calculate total cost with optional discount
    const tests = await MedicalTest.find({ _id: { $in: testIds }, isActive: true });
    const originalCost = tests.reduce((sum, t) => sum + (t.price || 0), 0);
    const discountPercent = Math.min(Math.max(Number(discount) || 0, 0), 100);
    const discountAmount = Math.round(originalCost * discountPercent / 100 * 100) / 100;
    const totalCost = Math.round((originalCost - discountAmount) * 100) / 100;

    const labRequest = new LabRequest({
      patientId,
      doctorId: doctorId || null,
      labId: labTechId,
      testIds,
      notes,
      totalCost,
      originalCost,
      discount: discountPercent,
      discountAmount,
      requestedBy: labTechId,
      clinicId: clinic._id,
      approvalStatus: 'approved'
    });

    await labRequest.save();

    // No debt is created here - debt is added only when lab tech marks request as completed (via updateRequest)

    res.status(201).json({
      success: true,
      message: 'تم طلب الفحوصات بنجاح',
      labRequest,
      totalCost
    });
  } catch (error) {
    console.error('Error requesting lab test (lab tech):', error);
    res.status(500).json({ message: 'فشل في طلب الفحوصات', error: error.message });
  }
};

// Delete lab request
exports.deleteRequest = async (req, res) => {
  try {
    const labTechId = req.user._id;
    const clinic = await getClinicForLabTech(labTechId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة' });
    }

    const { requestId } = req.params;
    const labRequest = await LabRequest.findById(requestId);
    if (!labRequest) {
      return res.status(404).json({ message: 'طلب الفحص غير موجود' });
    }

    // Remove related debt from financial if exists
    if (labRequest.totalCost > 0) {
      try {
        const clinicOwnerId = clinic.ownerId;
        const financial = await Financial.findOne({ doctorId: clinicOwnerId });
        if (financial) {
          const debtIndex = financial.debts.findIndex(
            d => d.patientId?.toString() === labRequest.patientId?.toString()
              && d.amount === labRequest.totalCost
              && d.description && d.description.includes('فحوصات مخبرية')
              && d.status === 'pending'
          );
          if (debtIndex !== -1) {
            financial.debts.splice(debtIndex, 1);
            await financial.save();
          }
        }
      } catch (debtErr) {
        console.error('Error removing debt for deleted lab request:', debtErr);
      }
    }

    await LabRequest.findByIdAndDelete(requestId);

    res.status(200).json({ success: true, message: 'تم حذف الطلب بنجاح' });
  } catch (error) {
    console.error('Error deleting lab request:', error);
    res.status(500).json({ message: 'فشل في حذف الطلب', error: error.message });
  }
};
