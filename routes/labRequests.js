const express = require('express');
const router = express.Router();
const LabRequest = require('../models/LabRequest');
const MedicalTest = require('../models/MedicalTest');
const Points = require('../models/Points');
const User = require('../models/User');
const Financial = require('../models/Financial');
const Clinic = require('../models/Clinic');
const multer = require('multer');
const path = require('path');

// Configure multer storage for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/lab-results/'); // Ensure this folder exists
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

// File filter to accept documents and images
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, images, text files, and Excel files are allowed'), false);
  }
};

const uploadFile = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // Limit to 10MB
});

// Create new lab request
router.post('/', async (req, res) => {
  try {
    const { patientId, doctorId, labId, testIds, notes, scheduledDate } = req.body;

    if (!patientId || !doctorId || !labId || !testIds || testIds.length === 0) {
      return res.status(400).json({ message: 'Patient, doctor, lab, and tests are required' });
    }

    // Verify tests exist
    const tests = await MedicalTest.find({ _id: { $in: testIds }, isActive: true });
    if (tests.length !== testIds.length) {
      return res.status(400).json({ message: 'Some tests are invalid or inactive' });
    }

    // Check if doctor is clinic-managed
    let isClinicManaged = false;
    let doctorClinicId = null;
    try {
      const doctor = await User.findById(doctorId);
      if (doctor && doctor.managedByClinic && doctor.clinicId) {
        isClinicManaged = true;
        doctorClinicId = doctor.clinicId;
      }
    } catch (e) {
      console.error('Error checking doctor clinic status:', e);
    }

    // Calculate total cost from tests
    const totalCost = tests.reduce((sum, t) => sum + (t.price || 0), 0);

    const labRequest = new LabRequest({
      patientId,
      doctorId,
      labId,
      testIds,
      notes,
      totalCost,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
      // Clinic-managed: needs accountant approval first
      // Independent: goes directly to lab (approved)
      approvalStatus: isClinicManaged ? 'pending_approval' : 'approved',
      clinicId: doctorClinicId || undefined
    });

    await labRequest.save();

    // Add lab test cost as DEBT to the patient
    if (totalCost > 0) {
      try {
        const testNames = tests.map(t => t.name).join(', ');
        
        if (isClinicManaged && doctorClinicId) {
          // Clinic-managed: add debt to clinic owner's financial
          const clinic = await Clinic.findById(doctorClinicId);
          if (clinic) {
            const clinicOwnerId = clinic.ownerId;
            let financial = await Financial.findOne({ doctorId: clinicOwnerId });
            if (!financial) {
              financial = new Financial({ doctorId: clinicOwnerId, totalEarnings: 0, totalExpenses: 0 });
            }
            financial.debts.push({
              patientId,
              doctorId,
              amount: totalCost,
              originalAmount: totalCost,
              description: `فحوصات مخبرية - ${testNames}`,
              date: new Date(),
              status: 'pending'
            });
            await financial.save();
            console.log(`Added lab test debt of ${totalCost} ILS for patient ${patientId} (clinic-managed)`);
          }
        } else {
          // Independent doctor: add debt to doctor's own financial
          let financial = await Financial.findOne({ doctorId });
          if (!financial) {
            financial = new Financial({ doctorId, totalEarnings: 0, totalExpenses: 0 });
          }
          financial.debts.push({
            patientId,
            doctorId,
            amount: totalCost,
            originalAmount: totalCost,
            description: `فحوصات مخبرية - ${testNames}`,
            date: new Date(),
            status: 'pending'
          });
          await financial.save();
          console.log(`Added lab test debt of ${totalCost} ILS for patient ${patientId} (independent doctor)`);
        }
      } catch (debtErr) {
        console.error('Error adding lab test debt:', debtErr);
        // Don't fail the request if debt recording fails
      }
    }

    // Award 10 points to patient for requesting a lab test
    try {
      let userPoints = await Points.findOne({ userId: patientId });
      if (!userPoints) {
        userPoints = new Points({ userId: patientId });
      }

      const testPoints = 10;
      userPoints.totalPoints += testPoints;
      userPoints.pointsHistory.push({
        points: testPoints,
        action: 'test',
        description: `Lab test request points - Request #${labRequest._id}`,
        referenceId: labRequest._id
      });

      await userPoints.save();

      // Update user's total points
      const patient = await User.findById(patientId);
      if (patient) {
        patient.totalPoints = userPoints.totalPoints;
        await patient.save({ validateBeforeSave: false });
        console.log(`Awarded 10 points to patient ${patientId} for lab test request`);
      }
    } catch (pointsError) {
      console.error('Error awarding lab test points:', pointsError);
      // Don't fail the request if points award fails
    }
    
    // Populate the request with test and user details
    const populatedRequest = await LabRequest.findById(labRequest._id)
      .populate('patientId', 'fullName idNumber mobileNumber')
      .populate('doctorId', 'fullName specialty')
      .populate('labId', 'fullName address')
      .populate('testIds', 'name type category estimatedDuration');

    res.status(201).json(populatedRequest);
  } catch (error) {
    console.error('Create lab request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get lab requests for a specific lab
router.get('/lab/:labId', async (req, res) => {
  try {
    const { labId } = req.params;
    const { status, page = 1, limit = 20 } = req.query;

    let filter = { labId };
    if (status) filter.status = status;

    const requests = await LabRequest.find(filter)
      .populate('patientId', 'fullName idNumber mobileNumber')
      .populate('doctorId', 'fullName specialty')
      .populate('testIds', 'name type category')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await LabRequest.countDocuments(filter);

    res.json({
      requests,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get lab requests error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get lab requests for a specific patient
router.get('/patient/:patientId', async (req, res) => {
  try {
    const { patientId } = req.params;
    const { status, page = 1, limit = 20 } = req.query;

    let filter = { patientId };
    if (status) filter.status = status;

    const requests = await LabRequest.find(filter)
      .populate('doctorId', 'fullName specialty')
      .populate('labId', 'fullName address')
      .populate('testIds', 'name type category')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await LabRequest.countDocuments(filter);

    res.json({
      requests,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get patient lab requests error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update lab request status
router.put('/:requestId/status', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, notes } = req.body;

    if (!['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const updateData = { status };
    if (notes) updateData.notes = notes;
    if (status === 'completed') updateData.completedDate = new Date();

    const request = await LabRequest.findByIdAndUpdate(
      requestId,
      { $set: updateData },
      { new: true }
    ).populate('patientId', 'fullName')
     .populate('doctorId', 'fullName')
     .populate('testIds', 'name');

    if (!request) {
      return res.status(404).json({ message: 'Lab request not found' });
    }

    res.json(request);
  } catch (error) {
    console.error('Update lab request status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Upload lab results
router.put('/:requestId/results', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { results } = req.body;

    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ message: 'Results array is required' });
    }

    const request = await LabRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ message: 'Lab request not found' });
    }

    // Validate results format
    for (const result of results) {
      if (!result.testId || !result.result) {
        return res.status(400).json({ message: 'Each result must have testId and result' });
      }
    }

    request.results = results;
    request.status = 'completed';
    request.completedDate = new Date();

    await request.save();

    const populatedRequest = await LabRequest.findById(requestId)
      .populate('patientId', 'fullName')
      .populate('doctorId', 'fullName')
      .populate('testIds', 'name normalRange unit')
      .populate('results.testId', 'name normalRange unit');

    res.json(populatedRequest);
  } catch (error) {
    console.error('Upload lab results error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get specific lab request
router.get('/:requestId', async (req, res) => {
  try {
    const request = await LabRequest.findById(req.params.requestId)
      .populate('patientId', 'fullName idNumber mobileNumber birthdate sex')
      .populate('doctorId', 'fullName specialty')
      .populate('labId', 'fullName address mobileNumber')
      .populate('testIds', 'name type category normalRange unit preparationInstructions')
      .populate('results.testId', 'name normalRange unit');

    if (!request) {
      return res.status(404).json({ message: 'Lab request not found' });
    }

    res.json(request);
  } catch (error) {
    console.error('Get lab request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete lab request
router.delete('/:requestId', async (req, res) => {
  try {
    const request = await LabRequest.findByIdAndDelete(req.params.requestId);
    if (!request) {
      return res.status(404).json({ message: 'Lab request not found' });
    }
    res.json({ message: 'Lab request deleted successfully' });
  } catch (error) {
    console.error('Delete lab request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Upload lab test result
router.post('/upload-result', uploadFile.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { patientId, doctorId, testName, notes, status } = req.body;

    if (!patientId || !doctorId) {
      return res.status(400).json({ message: 'Patient ID and Doctor ID are required' });
    }

    // Create file URL
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/lab-results/${req.file.filename}`;

    // Find the lab request for this patient by the doctor (get the most recent pending/in_progress one)
    const labRequest = await LabRequest.findOne({
      patientId,
      doctorId,
      status: { $in: ['pending', 'in_progress', 'completed'] }
    }).sort({ createdAt: -1 });

    if (labRequest) {
      // Add to existing lab request's results
      if (!labRequest.results) {
        labRequest.results = [];
      }

      labRequest.results.push({
        testId: null, // Can be matched later
        result: fileUrl,
        attachments: [req.file.filename],
        notes: notes || ''
      });

      if (status === 'completed') {
        labRequest.status = 'completed';
        labRequest.completedDate = new Date();
      }

      await labRequest.save();
    } else {
      // Create a new lab request if none exists
      const newLabRequest = new LabRequest({
        patientId,
        doctorId,
        labId: doctorId, // Using doctor as default
        testIds: [],
        status: status || 'completed',
        completedDate: new Date(),
        notes: testName || 'Lab result upload',
        results: [{
          result: fileUrl,
          attachments: [req.file.filename],
          notes: notes || ''
        }]
      });

      await newLabRequest.save();
    }

    const updatedRequest = await LabRequest.findOne({
      patientId,
      doctorId
    }).sort({ createdAt: -1 })
      .populate('patientId', 'fullName')
      .populate('doctorId', 'fullName');

    res.json({
      message: 'Lab result uploaded successfully',
      fileUrl: fileUrl,
      request: updatedRequest
    });
  } catch (error) {
    console.error('Upload lab result error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
