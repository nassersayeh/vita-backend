const LabRequest = require('../models/LabRequest');
const MedicalTest = require('../models/MedicalTest');
const User = require('../models/User');
const Clinic = require('../models/Clinic');

// Get clinic for this lab tech
const getClinicForLabTech = async (labTechId) => {
  const clinic = await Clinic.findOne({
    'staff.userId': labTechId,
    'staff.role': 'LabTech',
    'staff.status': 'active'
  });
  return clinic;
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

    // Get requests where lab is this user or clinic-wide
    const queryFilter = { labId: labTechId };
    if (clinic) {
      const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
      queryFilter.$or = [
        { labId: labTechId },
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
      queryFilter = {
        $or: [
          { labId: labTechId },
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
    const { requestId } = req.params;
    const { status, results, notes } = req.body;

    const request = await LabRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ message: 'طلب الفحص غير موجود' });
    }

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

    await request.save();

    const updatedRequest = await LabRequest.findById(requestId)
      .populate('patientId', 'fullName mobileNumber')
      .populate('doctorId', 'fullName specialty')
      .populate('testIds', 'name type category price normalRange unit');

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
