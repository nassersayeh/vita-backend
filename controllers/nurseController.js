const NurseNote = require('../models/NurseNote');
const User = require('../models/User');
const Clinic = require('../models/Clinic');

// Get clinic for this nurse
const getClinicForNurse = async (nurseId) => {
  const clinic = await Clinic.findOne({
    'staff.userId': nurseId,
    'staff.role': 'Nurse',
    'staff.status': 'active'
  });
  return clinic;
};

// Get all patients in the nurse's clinic
exports.getPatients = async (req, res) => {
  try {
    const nurseId = req.user._id;
    const clinic = await getClinicForNurse(nurseId);
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
    console.error('Error fetching nurse patients:', error);
    res.status(500).json({ message: 'فشل في جلب قائمة المرضى', error: error.message });
  }
};

// Create a nurse note for a patient
exports.createNote = async (req, res) => {
  try {
    const nurseId = req.user._id;
    const clinic = await getClinicForNurse(nurseId);
    
    const {
      patientId,
      vitals,
      chiefComplaint,
      observations,
      nursingNotes,
      instructions,
      allergiesNoted,
      currentMedications,
      priority,
      assignedDoctor
    } = req.body;

    if (!patientId) {
      return res.status(400).json({ message: 'يجب تحديد المريض' });
    }

    const note = new NurseNote({
      patient: patientId,
      nurse: nurseId,
      clinicId: clinic ? clinic._id : null,
      vitals,
      chiefComplaint,
      observations,
      nursingNotes,
      instructions,
      allergiesNoted,
      currentMedications,
      priority: priority || 'normal',
      assignedDoctor,
      status: 'completed'
    });

    await note.save();

    const populatedNote = await NurseNote.findById(note._id)
      .populate('patient', 'fullName mobileNumber profileImage')
      .populate('nurse', 'fullName')
      .populate('assignedDoctor', 'fullName specialty');

    res.status(201).json({
      success: true,
      message: 'تم إنشاء الملاحظة بنجاح',
      note: populatedNote
    });
  } catch (error) {
    console.error('Error creating nurse note:', error);
    res.status(500).json({ message: 'فشل في إنشاء الملاحظة', error: error.message });
  }
};

// Get all notes by this nurse
exports.getNotes = async (req, res) => {
  try {
    const nurseId = req.user._id;
    const { patientId, startDate, endDate, page = 1, limit = 20 } = req.query;

    const query = { nurse: nurseId };
    if (patientId) query.patient = patientId;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const notes = await NurseNote.find(query)
      .populate('patient', 'fullName mobileNumber profileImage')
      .populate('assignedDoctor', 'fullName specialty')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await NurseNote.countDocuments(query);

    res.status(200).json({
      success: true,
      notes,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (error) {
    console.error('Error fetching nurse notes:', error);
    res.status(500).json({ message: 'فشل في جلب الملاحظات', error: error.message });
  }
};

// Get a specific note
exports.getNoteById = async (req, res) => {
  try {
    const note = await NurseNote.findById(req.params.noteId)
      .populate('patient', 'fullName mobileNumber profileImage birthdate sex')
      .populate('nurse', 'fullName')
      .populate('assignedDoctor', 'fullName specialty');

    if (!note) {
      return res.status(404).json({ message: 'الملاحظة غير موجودة' });
    }

    res.status(200).json({ success: true, note });
  } catch (error) {
    console.error('Error fetching note:', error);
    res.status(500).json({ message: 'فشل في جلب الملاحظة', error: error.message });
  }
};

// Update a note
exports.updateNote = async (req, res) => {
  try {
    const nurseId = req.user._id;
    const note = await NurseNote.findOne({ _id: req.params.noteId, nurse: nurseId });

    if (!note) {
      return res.status(404).json({ message: 'الملاحظة غير موجودة أو ليس لديك صلاحية' });
    }

    const allowedFields = [
      'vitals', 'chiefComplaint', 'observations', 'nursingNotes',
      'instructions', 'allergiesNoted', 'currentMedications',
      'priority', 'assignedDoctor', 'status'
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        note[field] = req.body[field];
      }
    }

    await note.save();

    const updatedNote = await NurseNote.findById(note._id)
      .populate('patient', 'fullName mobileNumber profileImage')
      .populate('nurse', 'fullName')
      .populate('assignedDoctor', 'fullName specialty');

    res.status(200).json({
      success: true,
      message: 'تم تحديث الملاحظة بنجاح',
      note: updatedNote
    });
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ message: 'فشل في تحديث الملاحظة', error: error.message });
  }
};

// Delete a note
exports.deleteNote = async (req, res) => {
  try {
    const nurseId = req.user._id;
    const note = await NurseNote.findOneAndDelete({ _id: req.params.noteId, nurse: nurseId });

    if (!note) {
      return res.status(404).json({ message: 'الملاحظة غير موجودة أو ليس لديك صلاحية' });
    }

    res.status(200).json({
      success: true,
      message: 'تم حذف الملاحظة بنجاح'
    });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ message: 'فشل في حذف الملاحظة', error: error.message });
  }
};

// Get doctors in the clinic (for assigning patients)
exports.getClinicDoctors = async (req, res) => {
  try {
    const nurseId = req.user._id;
    const clinic = await getClinicForNurse(nurseId);
    if (!clinic) {
      return res.status(404).json({ message: 'لم يتم العثور على عيادة مرتبطة بحسابك' });
    }

    const doctorIds = clinic.doctors
      .filter(d => d.status === 'active')
      .map(d => d.doctorId);

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

// Get dashboard stats
exports.getDashboardStats = async (req, res) => {
  try {
    const nurseId = req.user._id;
    const clinic = await getClinicForNurse(nurseId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [todayNotes, monthNotes, totalNotes] = await Promise.all([
      NurseNote.countDocuments({ nurse: nurseId, createdAt: { $gte: today, $lt: tomorrow } }),
      NurseNote.countDocuments({ nurse: nurseId, createdAt: { $gte: monthStart } }),
      NurseNote.countDocuments({ nurse: nurseId }),
    ]);

    // Get patient count from clinic
    let patientCount = 0;
    if (clinic) {
      const doctorIds = clinic.doctors.filter(d => d.status === 'active').map(d => d.doctorId);
      const doctors = await User.find({ _id: { $in: doctorIds } }, 'patients');
      const allPatientIds = new Set();
      doctors.forEach(d => (d.patients || []).forEach(p => allPatientIds.add(p.toString())));
      patientCount = allPatientIds.size;
    }

    res.status(200).json({
      success: true,
      stats: {
        todayNotes,
        monthNotes,
        totalNotes,
        patientCount,
        clinicName: clinic?.name || ''
      }
    });
  } catch (error) {
    console.error('Error fetching nurse stats:', error);
    res.status(500).json({ message: 'فشل في جلب الإحصائيات', error: error.message });
  }
};
