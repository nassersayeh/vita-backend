// New Medical Record Routes (routes/medicalRecord.js)
// Create a new file for medical record routes

const express = require('express');
const router = express.Router();
const MedicalRecord = require('../models/MedicalRecord');
const Financial = require('../models/Financial');

// GET patient history
router.get('/patient/:patientId', async (req, res) => {
  try {
    const { patientId } = req.params;
    const records = await MedicalRecord.find({ patient: patientId })
      .populate('doctor', 'fullName specialty')
      .populate('lastEditedBy', 'fullName')
      .sort({ date: -1 });
    res.json(records);
  } catch (err) {
    console.error('Error fetching patient history:', err);
    res.status(500).json({ message: 'Server error fetching patient history' });
  }
});

// GET clinic-wide patient records (all records from doctors in the same clinic)
router.get('/patient/:patientId/clinic/:clinicId', async (req, res) => {
  try {
    const { patientId, clinicId } = req.params;
    const Clinic = require('../models/Clinic');
    
    // Verify the clinic exists
    const clinic = await Clinic.findById(clinicId);
    if (!clinic) {
      return res.status(404).json({ message: 'Clinic not found' });
    }
    
    // Get all doctor IDs in this clinic (including owner)
    const clinicDoctorIds = clinic.doctors
      .filter(d => d.status === 'active')
      .map(d => d.doctorId);
    clinicDoctorIds.push(clinic.ownerId); // include clinic owner
    
    // Find records that either:
    // 1. Have clinicId matching this clinic, OR
    // 2. Were created by a doctor who belongs to this clinic (for old records without clinicId)
    const records = await MedicalRecord.find({
      patient: patientId,
      $or: [
        { clinicId: clinicId },
        { doctor: { $in: clinicDoctorIds } }
      ]
    })
      .populate('doctor', 'fullName specialty')
      .populate('lastEditedBy', 'fullName')
      .sort({ date: -1 });
    
    res.json(records);
  } catch (err) {
    console.error('Error fetching clinic patient records:', err);
    res.status(500).json({ message: 'Server error fetching clinic patient records' });
  }
});

// GET clinic-wide patient records by auto-detecting the user's clinic
router.get('/patient/:patientId/my-clinic/:userId', async (req, res) => {
  try {
    const { patientId, userId } = req.params;
    const Clinic = require('../models/Clinic');
    const User = require('../models/User');
    
    // Find the user's clinic - check if they're an owner, doctor, or staff
    let clinic = await Clinic.findOne({ ownerId: userId });
    
    if (!clinic) {
      // Check if user is a doctor in a clinic
      clinic = await Clinic.findOne({ 'doctors.doctorId': userId, 'doctors.status': 'active' });
    }
    
    if (!clinic) {
      // Check if user is a staff member
      clinic = await Clinic.findOne({ 'staff.userId': userId, 'staff.status': 'active' });
    }
    
    if (!clinic) {
      // Check user's clinicId field
      const user = await User.findById(userId);
      if (user && user.clinicId) {
        clinic = await Clinic.findById(user.clinicId);
      }
    }
    
    if (!clinic) {
      // No clinic found - return only this user's records
      const records = await MedicalRecord.find({ patient: patientId, doctor: userId })
        .populate('doctor', 'fullName specialty')
        .populate('lastEditedBy', 'fullName')
        .sort({ date: -1 });
      return res.json(records);
    }
    
    // Get all member IDs in this clinic
    const clinicMemberIds = clinic.doctors
      .filter(d => d.status === 'active')
      .map(d => d.doctorId);
    clinicMemberIds.push(clinic.ownerId);
    
    // Find all records from clinic members for this patient
    const records = await MedicalRecord.find({
      patient: patientId,
      $or: [
        { clinicId: clinic._id },
        { doctor: { $in: clinicMemberIds } }
      ]
    })
      .populate('doctor', 'fullName specialty')
      .populate('lastEditedBy', 'fullName')
      .sort({ date: -1 });
    
    res.json(records);
  } catch (err) {
    console.error('Error fetching my-clinic patient records:', err);
    res.status(500).json({ message: 'Server error fetching clinic patient records' });
  }
});

// POST new medical record (for creating records, e.g., by doctors)
router.post('/', async (req, res) => {
  try {
    // Auto-set clinicId from doctor's clinic if not provided
    if (!req.body.clinicId && req.body.doctor) {
      try {
        const User = require('../models/User');
        const doctor = await User.findById(req.body.doctor);
        if (doctor && doctor.clinicId) {
          req.body.clinicId = doctor.clinicId;
        } else {
          // Check if this doctor is in any clinic
          const Clinic = require('../models/Clinic');
          const clinic = await Clinic.findOne({
            $or: [
              { ownerId: req.body.doctor },
              { 'doctors.doctorId': req.body.doctor, 'doctors.status': 'active' }
            ]
          });
          if (clinic) {
            req.body.clinicId = clinic._id;
          }
        }
      } catch (clinicErr) {
        console.error('Error auto-setting clinicId:', clinicErr);
      }
    }

    const newRecord = new MedicalRecord(req.body);
    const savedRecord = await newRecord.save();

    // Update the latest appointment with the doctor's fee so accountant can see it
    if (req.body.doctor && req.body.patient) {
      try {
        const Appointment = require('../models/Appointment');
        const consultationFee = req.body.consultationFee || req.body.treatmentCost || req.body.specialtyFields?.treatmentCost || 0;
        
        if (consultationFee > 0) {
          // Find the latest confirmed/pending appointment for this doctor-patient pair (today or most recent)
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          
          let latestAppointment = await Appointment.findOne({
            doctorId: req.body.doctor,
            patient: req.body.patient,
            status: { $in: ['confirmed', 'pending'] },
            appointmentDateTime: { $gte: today, $lt: tomorrow }
          }).sort({ appointmentDateTime: -1 });
          
          // If no today appointment, find the most recent confirmed one
          if (!latestAppointment) {
            latestAppointment = await Appointment.findOne({
              doctorId: req.body.doctor,
              patient: req.body.patient,
              status: 'confirmed',
              isPaid: false
            }).sort({ appointmentDateTime: -1 });
          }
          
          if (latestAppointment) {
            latestAppointment.doctorFee = consultationFee;
            if (!latestAppointment.appointmentFee || latestAppointment.appointmentFee === 0) {
              latestAppointment.appointmentFee = consultationFee;
            }
            await latestAppointment.save();
            console.log(`Doctor fee of ${consultationFee} ILS set on appointment ${latestAppointment._id}`);
          }
        }
      } catch (aptFeeError) {
        console.error('Error updating appointment with doctor fee:', aptFeeError);
      }
    }

    // If treatment has cost (dental, PT, etc.), add debt to patient
    const treatmentCost = req.body.treatmentCost || req.body.specialtyFields?.treatmentCost;
    if (treatmentCost && treatmentCost > 0 && req.body.doctor && req.body.patient) {
      try {
        const User = require('../models/User');
        const Clinic = require('../models/Clinic');
        
        // Get doctor info for the description
        const doctorUser = await User.findById(req.body.doctor);
        const doctorName = doctorUser?.fullName || 'طبيب';
        
        // Find the clinic this doctor belongs to
        let clinic = null;
        if (doctorUser?.clinicId) {
          clinic = await Clinic.findById(doctorUser.clinicId);
        }
        if (!clinic) {
          clinic = await Clinic.findOne({
            $or: [
              { ownerId: req.body.doctor },
              { 'doctors.doctorId': req.body.doctor, 'doctors.status': 'active' }
            ]
          });
        }
        
        // Determine the financial record owner: clinic owner if in a clinic, otherwise the doctor
        const financialOwnerId = clinic ? clinic.ownerId : req.body.doctor;
        
        // Find or create financial record
        let ownerFinancial = await Financial.findOne({ doctorId: financialOwnerId });
        
        if (!ownerFinancial) {
          ownerFinancial = new Financial({
            doctorId: financialOwnerId,
            transactions: [],
            expenses: [],
            debts: [],
            totalEarnings: 0,
            totalExpenses: 0,
            balance: 0
          });
        }

        // Determine debt description based on specialty - include doctor name
        let debtDescription;
        if (req.body.dentalTreatment || req.body.specialtyFields?.dentalTreatment) {
          debtDescription = `علاج أسنان: ${req.body.dentalTreatment || req.body.specialtyFields.dentalTreatment} (د. ${doctorName})`;
        } else if (req.body.ptTreatment || req.body.specialtyFields?.ptTreatment) {
          debtDescription = `جلسة علاج طبيعي: ${req.body.ptTreatment || req.body.specialtyFields.ptTreatment || 'Physical Therapy Session'} (د. ${doctorName})`;
        } else {
          debtDescription = `${req.body.title || 'علاج طبي'} (د. ${doctorName})`;
        }

        ownerFinancial.debts.push({
          patientId: req.body.patient,
          doctorId: req.body.doctor,
          amount: parseFloat(treatmentCost),
          description: debtDescription,
          date: new Date(),
          status: 'pending',
        });

        await ownerFinancial.save();
        console.log(`Debt of ${treatmentCost} ILS added for patient ${req.body.patient} on clinic owner ${financialOwnerId} financial record`);
      } catch (debtError) {
        console.error('Error adding patient debt:', debtError);
        // Don't fail the medical record creation if debt creation fails
      }
    }

    // If followUpDate is provided, create a follow-up appointment
    if (req.body.followUpDate && req.body.doctor && req.body.patient) {
      try {
        const Appointment = require('../models/Appointment');
        const User = require('../models/User');
        const Notification = require('../models/Notification');

        const followUpDateTime = new Date(req.body.followUpDate);

        // Validate follow-up date is in the future
        if (followUpDateTime > new Date()) {
          // Check if appointment already exists
          const existingAppointment = await Appointment.findOne({
            doctorId: req.body.doctor,
            patient: req.body.patient,
            appointmentDateTime: followUpDateTime
          });

          if (!existingAppointment) {
            // Get doctor's workplace info
            const doctor = await User.findById(req.body.doctor);
            const workplace = doctor?.workplaces?.[0]; // Use first workplace

            if (workplace) {
              // Create follow-up appointment
              const followUpAppointment = new Appointment({
                doctorId: req.body.doctor,
                patient: req.body.patient,
                appointmentDateTime: followUpDateTime,
                durationMinutes: req.body.durationMinutes || 30,
                workplaceName: workplace.name,
                workplaceAddress: workplace.address,
                reason: `Follow-up from ${req.body.title || 'medical record'}`,
                notes: `Follow-up appointment created from medical record: ${req.body.diagnosis || ''}`,
                urgency: 'normal',
                status: 'confirmed', // Auto-confirm follow-up appointments
              });

              await followUpAppointment.save();

              // Create notification for the doctor
              const patientAccount = await User.findById(req.body.patient);
              await Notification.create({
                user: req.body.doctor,
                type: 'appointment',
                message: `تم إنشاء موعد متابعة مع المريض ${patientAccount?.fullName || 'غير معروف'} في ${followUpDateTime.toLocaleDateString('ar')}`,
                relatedId: followUpAppointment._id,
              });

              console.log('Follow-up appointment created successfully');
            } else {
              console.log('No workplace found for doctor, skipping follow-up appointment creation');
            }
          }
        }
      } catch (appointmentError) {
        console.error('Error creating follow-up appointment:', appointmentError);
        // Don't fail the medical record creation if appointment creation fails
      }
    }

    // Calculate total remaining debt for the patient with this doctor
    let totalPatientDebt = 0;
    try {
      if (req.body.doctor && req.body.patient) {
        const doctorFinancial = await Financial.findOne({ doctorId: req.body.doctor });
        if (doctorFinancial && doctorFinancial.debts) {
          totalPatientDebt = doctorFinancial.debts
            .filter(d => d.patientId && d.patientId.toString() === req.body.patient.toString() && d.status === 'pending')
            .reduce((sum, d) => sum + (d.amount || 0), 0);
        }
      }
    } catch (debtCalcErr) {
      console.error('Error calculating total patient debt:', debtCalcErr);
    }

    res.status(201).json({ 
      ...savedRecord.toObject(),
      totalPatientDebt: totalPatientDebt
    });
  } catch (err) {
    console.error('Error creating medical record:', err);
    res.status(500).json({ message: 'Server error creating medical record' });
  }
});

// PUT update medical record (only allow original doctor to update followUpDate)
router.put('/:recordId', async (req, res) => {
  try {
    const { recordId } = req.params;
    const { followUpDate, doctorId } = req.body;

    // Find the existing record
    const existingRecord = await MedicalRecord.findById(recordId);
    if (!existingRecord) {
      return res.status(404).json({ message: 'Medical record not found' });
    }

    // Only allow the original doctor to update the followUpDate
    if (followUpDate !== undefined && existingRecord.doctor.toString() !== doctorId) {
      return res.status(403).json({ message: 'Only the original doctor can update the follow-up date' });
    }

    // Prepare update object
    const updateData = {};
    if (followUpDate !== undefined) {
      updateData.followUpDate = followUpDate || undefined; // Allow clearing the date

      // If followUpDate is provided and different from current, handle appointment creation/update
      if (followUpDate && (!existingRecord.followUpDate || new Date(followUpDate).getTime() !== existingRecord.followUpDate.getTime())) {
        try {
          const Appointment = require('../models/Appointment');
          const User = require('../models/User');
          const Notification = require('../models/Notification');

          const followUpDateTime = new Date(followUpDate);

          // Validate follow-up date is in the future
          if (followUpDateTime > new Date()) {
            // Check if appointment already exists
            const existingAppointment = await Appointment.findOne({
              doctorId: existingRecord.doctor,
              patient: existingRecord.patient,
              appointmentDateTime: followUpDateTime
            });

            if (!existingAppointment) {
              // Get doctor's workplace info
              const doctor = await User.findById(existingRecord.doctor);
              const workplace = doctor?.workplaces?.[0]; // Use first workplace

              if (workplace) {
                // Create follow-up appointment
                const followUpAppointment = new Appointment({
                  doctorId: existingRecord.doctor,
                  patient: existingRecord.patient,
                  appointmentDateTime: followUpDateTime,
                  workplaceName: workplace.name,
                  workplaceAddress: workplace.address,
                  reason: `Follow-up from ${existingRecord.title || 'medical record'}`,
                  notes: `Follow-up appointment created from medical record: ${existingRecord.diagnosis || ''}`,
                  urgency: 'normal',
                  status: 'confirmed', // Auto-confirm follow-up appointments
                  isPaid: false, // Explicitly set to not paid
                  paymentAmount: 0,
                  appointmentFee: 0, // No fee by default
                  debt: 0,
                  debtStatus: 'none'
                });

                await followUpAppointment.save();

                // Create notification for the doctor
                const patientAccount = await User.findById(existingRecord.patient);
                await Notification.create({
                  user: existingRecord.doctor,
                  type: 'appointment',
                  message: `تم إنشاء موعد متابعة مع المريض ${patientAccount?.fullName || 'غير معروف'} في ${followUpDateTime.toLocaleDateString('ar')}`,
                  relatedId: followUpAppointment._id,
                });

                console.log('Follow-up appointment created successfully');
              }
            }
          }
        } catch (appointmentErr) {
          console.error('Error creating follow-up appointment:', appointmentErr);
          // Don't fail the record update if appointment creation fails
        }
      }
    }

    // Update the record
    const updatedRecord = await MedicalRecord.findByIdAndUpdate(
      recordId,
      updateData,
      { new: true }
    ).populate('doctor', 'fullName specialty');

    res.json(updatedRecord);
  } catch (err) {
    console.error('Error updating medical record:', err);
    res.status(500).json({ message: 'Server error updating medical record' });
  }
});

// GET single medical record with all its follow-ups (treatment journey)
router.get('/:recordId/journey', async (req, res) => {
  try {
    const { recordId } = req.params;
    
    // Get the requested record
    const record = await MedicalRecord.findById(recordId)
      .populate('doctor', 'fullName specialty')
      .populate('patient', 'fullName mobileNumber')
      .populate('lastEditedBy', 'fullName');
    
    if (!record) {
      return res.status(404).json({ message: 'Medical record not found' });
    }

    // Determine the root record (initial record)
    let rootRecordId = recordId;
    if (record.parentRecord) {
      rootRecordId = record.parentRecord;
    }

    // Get all records in this treatment journey (initial + all follow-ups)
    const journeyRecords = await MedicalRecord.find({
      $or: [
        { _id: rootRecordId },
        { parentRecord: rootRecordId }
      ]
    })
      .populate('doctor', 'fullName specialty')
      .populate('lastEditedBy', 'fullName')
      .sort({ visitNumber: 1, date: 1 });

    res.json({
      rootRecord: rootRecordId,
      currentRecord: record,
      journey: journeyRecords,
      totalVisits: journeyRecords.length
    });
  } catch (err) {
    console.error('Error fetching treatment journey:', err);
    res.status(500).json({ message: 'Server error fetching treatment journey' });
  }
});

// GET all initial records for a patient (to show treatment cases)
router.get('/patient/:patientId/cases', async (req, res) => {
  try {
    const { patientId } = req.params;
    
    // Get all initial records (treatment cases)
    const cases = await MedicalRecord.find({ 
      patient: patientId,
      $or: [
        { recordType: 'initial' },
        { recordType: { $exists: false } }, // Include old records without recordType
        { parentRecord: null }
      ]
    })
      .populate('doctor', 'fullName specialty')
      .sort({ date: -1 });

    // For each case, count follow-ups
    const casesWithFollowUpCount = await Promise.all(
      cases.map(async (caseRecord) => {
        const followUpCount = await MedicalRecord.countDocuments({
          parentRecord: caseRecord._id
        });
        return {
          ...caseRecord.toObject(),
          followUpCount
        };
      })
    );

    res.json(casesWithFollowUpCount);
  } catch (err) {
    console.error('Error fetching patient cases:', err);
    res.status(500).json({ message: 'Server error fetching patient cases' });
  }
});

// POST create follow-up report for an existing record
router.post('/:recordId/followup', async (req, res) => {
  try {
    const { recordId } = req.params;
    const followUpData = req.body;

    // Get the parent record
    const parentRecord = await MedicalRecord.findById(recordId);
    if (!parentRecord) {
      return res.status(404).json({ message: 'Parent medical record not found' });
    }

    // Determine root record ID
    const rootRecordId = parentRecord.parentRecord || parentRecord._id;

    // Count existing follow-ups to determine visit number
    const existingFollowUps = await MedicalRecord.countDocuments({
      $or: [
        { _id: rootRecordId },
        { parentRecord: rootRecordId }
      ]
    });

    // Create follow-up record inheriting from parent
    const followUpRecord = new MedicalRecord({
      patient: parentRecord.patient,
      doctor: followUpData.doctor || parentRecord.doctor,
      date: followUpData.date || new Date(),
      recordType: 'followup',
      parentRecord: rootRecordId,
      visitNumber: existingFollowUps + 1,
      
      // Inherit from parent but allow override
      title: followUpData.title || `Follow-up #${existingFollowUps} - ${parentRecord.title || parentRecord.diagnosis}`,
      chiefComplaint: followUpData.chiefComplaint || parentRecord.chiefComplaint,
      historyOfPresentIllness: followUpData.historyOfPresentIllness || parentRecord.historyOfPresentIllness,
      pastMedicalHistory: followUpData.pastMedicalHistory || parentRecord.pastMedicalHistory,
      medications: followUpData.medications || parentRecord.medications,
      allergies: followUpData.allergies || parentRecord.allergies,
      vitals: followUpData.vitals || {},
      examinationFindings: followUpData.examinationFindings || '',
      investigations: followUpData.investigations || '',
      diagnosis: followUpData.diagnosis || parentRecord.diagnosis,
      treatmentPlan: followUpData.treatmentPlan || parentRecord.treatmentPlan,
      followUpDate: followUpData.followUpDate || null,
      notes: followUpData.notes || '',
      
      // Treatment field - for all doctors
      treatment: followUpData.treatment || '',
      
      // Dental specialty fields
      dentalTreatment: followUpData.dentalTreatment || '',
      selectedTeeth: followUpData.selectedTeeth || [],
      treatmentCost: followUpData.treatmentCost ? parseFloat(followUpData.treatmentCost) : 0,
      
      // Physical Therapy specialty fields
      ptTreatment: followUpData.ptTreatment || '',
      selectedMuscles: followUpData.selectedMuscles || [],
      
      // Follow-up specific fields
      followUpNotes: {
        progressStatus: followUpData.progressStatus || null,
        progressDescription: followUpData.progressDescription || '',
        treatmentChanges: followUpData.treatmentChanges || '',
        newSymptoms: followUpData.newSymptoms || '',
        medicationResponse: followUpData.medicationResponse || '',
        sideEffects: followUpData.sideEffects || '',
        patientCompliance: followUpData.patientCompliance || null,
        complianceNotes: followUpData.complianceNotes || '',
        outcomeNotes: followUpData.outcomeNotes || '',
        nextSteps: followUpData.nextSteps || '',
        recommendations: followUpData.recommendations || ''
      },
      
      specialtyFields: followUpData.specialtyFields || parentRecord.specialtyFields,
      attachments: followUpData.attachments || []
    });

    const savedFollowUp = await followUpRecord.save();

    // Handle payment - add to doctor's income AND reduce patient's debt from clinic owner's financial
    const paymentAmount = followUpData.paymentAmount ? parseFloat(followUpData.paymentAmount) : 0;
    if (paymentAmount > 0 && !isNaN(paymentAmount) && isFinite(paymentAmount)) {
      try {
        const doctorId = followUpData.doctor || parentRecord.doctor;
        const patientId = parentRecord.patient;
        
        const User = require('../models/User');
        const Clinic = require('../models/Clinic');
        
        // Find the clinic this doctor belongs to
        const doctorUser = await User.findById(doctorId);
        let clinic = null;
        if (doctorUser?.clinicId) {
          clinic = await Clinic.findById(doctorUser.clinicId);
        }
        if (!clinic) {
          clinic = await Clinic.findOne({
            $or: [
              { ownerId: doctorId },
              { 'doctors.doctorId': doctorId, 'doctors.status': 'active' }
            ]
          });
        }
        const financialOwnerId = clinic ? clinic.ownerId : doctorId;
        
        // 1. Add to clinic owner's income (transactions)
        let ownerFinancial = await Financial.findOne({ doctorId: financialOwnerId });
        if (!ownerFinancial) {
          ownerFinancial = new Financial({ doctorId: financialOwnerId, transactions: [], expenses: [], debts: [] });
        }
        
        const doctorName = doctorUser?.fullName || 'طبيب';
        ownerFinancial.transactions.push({
          date: new Date(),
          amount: paymentAmount,
          description: `Follow-up payment - Visit #${savedFollowUp.visitNumber} (د. ${doctorName})`,
          paymentMethod: followUpData.paymentMethod || 'Cash',
          patientId: patientId
        });
        ownerFinancial.totalEarnings = (ownerFinancial.totalEarnings || 0) + paymentAmount;
        
        // 2. Reduce patient's debt from clinic owner's financial record
        if (ownerFinancial.debts && ownerFinancial.debts.length > 0) {
          let remainingPayment = paymentAmount;
          
          for (let i = 0; i < ownerFinancial.debts.length && remainingPayment > 0; i++) {
            const debt = ownerFinancial.debts[i];
            if (debt.patientId && debt.patientId.toString() === patientId.toString() && debt.status === 'pending') {
              if (remainingPayment >= debt.amount) {
                remainingPayment -= debt.amount;
                debt.amount = 0;
                debt.status = 'paid';
                console.log(`✅ Debt fully paid: ${debt.description}`);
              } else {
                debt.amount -= remainingPayment;
                console.log(`✅ Debt partially paid: ${debt.description}, remaining: ${debt.amount}`);
                remainingPayment = 0;
              }
            }
          }
          
          ownerFinancial.debts = ownerFinancial.debts.filter(d => d.status !== 'paid' || d.amount > 0);
        }
        
        await ownerFinancial.save();
        console.log('✅ Follow-up payment added to clinic owner income:', paymentAmount);
        
        // 3. Also check doctor's own financial for old debts (backwards compatibility)
        if (financialOwnerId.toString() !== doctorId.toString()) {
          let doctorFinancial = await Financial.findOne({ doctorId: doctorId });
          if (doctorFinancial && doctorFinancial.debts && doctorFinancial.debts.length > 0) {
            let remainingPayment = paymentAmount;
            for (let i = 0; i < doctorFinancial.debts.length && remainingPayment > 0; i++) {
              const debt = doctorFinancial.debts[i];
              if (debt.patientId && debt.patientId.toString() === patientId.toString() && debt.status === 'pending') {
                if (remainingPayment >= debt.amount) {
                  remainingPayment -= debt.amount;
                  debt.amount = 0;
                  debt.status = 'paid';
                } else {
                  debt.amount -= remainingPayment;
                  remainingPayment = 0;
                }
              }
            }
            doctorFinancial.debts = doctorFinancial.debts.filter(d => d.status !== 'paid' || d.amount > 0);
            await doctorFinancial.save();
          }
        }
        
      } catch (financialErr) {
        console.error('Error adding follow-up payment to income:', financialErr);
      }
    }

    // Handle treatment cost - add to patient's debt (stored in clinic owner's financial record)
    const treatmentCost = followUpData.treatmentCost ? parseFloat(followUpData.treatmentCost) : 0;
    if (treatmentCost > 0 && !isNaN(treatmentCost) && isFinite(treatmentCost)) {
      try {
        const doctorId = followUpData.doctor || parentRecord.doctor;
        const patientId = parentRecord.patient;
        
        const User = require('../models/User');
        const Clinic = require('../models/Clinic');
        
        // Get doctor info for the description
        const doctorUser = await User.findById(doctorId);
        const doctorName = doctorUser?.fullName || 'طبيب';
        
        // Find the clinic this doctor belongs to
        let clinic = null;
        if (doctorUser?.clinicId) {
          clinic = await Clinic.findById(doctorUser.clinicId);
        }
        if (!clinic) {
          clinic = await Clinic.findOne({
            $or: [
              { ownerId: doctorId },
              { 'doctors.doctorId': doctorId, 'doctors.status': 'active' }
            ]
          });
        }
        
        // Save debt to clinic owner's financial record
        const financialOwnerId = clinic ? clinic.ownerId : doctorId;
        
        let ownerFinancial = await Financial.findOne({ doctorId: financialOwnerId });
        if (!ownerFinancial) {
          ownerFinancial = new Financial({ doctorId: financialOwnerId, transactions: [], expenses: [], debts: [] });
        }
        
        // Generate description based on dental treatment - include doctor name
        const teethInfo = followUpData.selectedTeeth?.length ? 
          ` (${followUpData.selectedTeeth.map(t => t.toothName || t.name).join(', ')})` : '';
        
        ownerFinancial.debts.push({
          patientId: patientId,
          doctorId: doctorId,
          amount: treatmentCost,
          description: `${followUpData.dentalTreatment || 'Treatment'} - Follow-up Visit #${savedFollowUp.visitNumber}${teethInfo} (د. ${doctorName})`,
          date: new Date(),
          status: 'pending'
        });
        
        await ownerFinancial.save();
        console.log(`✅ Follow-up treatment cost added as patient debt on clinic owner ${financialOwnerId}:`, treatmentCost);
      } catch (debtErr) {
        console.error('Error adding follow-up treatment cost as debt:', debtErr);
      }
    }
    
    // Handle PT cost - add to patient's debt (stored in clinic owner's financial record)
    const ptCost = followUpData.ptCost ? parseFloat(followUpData.ptCost) : 0;
    if (ptCost > 0 && !isNaN(ptCost) && isFinite(ptCost)) {
      try {
        const doctorId = followUpData.doctor || parentRecord.doctor;
        const patientId = parentRecord.patient;
        
        const User = require('../models/User');
        const Clinic = require('../models/Clinic');
        
        // Get doctor info for the description
        const doctorUser = await User.findById(doctorId);
        const doctorName = doctorUser?.fullName || 'طبيب';
        
        // Find the clinic this doctor belongs to
        let clinic = null;
        if (doctorUser?.clinicId) {
          clinic = await Clinic.findById(doctorUser.clinicId);
        }
        if (!clinic) {
          clinic = await Clinic.findOne({
            $or: [
              { ownerId: doctorId },
              { 'doctors.doctorId': doctorId, 'doctors.status': 'active' }
            ]
          });
        }
        
        // Save debt to clinic owner's financial record
        const financialOwnerId = clinic ? clinic.ownerId : doctorId;
        
        let ownerFinancial = await Financial.findOne({ doctorId: financialOwnerId });
        if (!ownerFinancial) {
          ownerFinancial = new Financial({ doctorId: financialOwnerId, transactions: [], expenses: [], debts: [] });
        }
        
        // Generate description based on PT treatment - include doctor name
        const muscleInfo = followUpData.selectedMuscles?.length ? 
          ` (${followUpData.selectedMuscles.map(m => m.muscleName || m.muscleNameAr).join(', ')})` : '';
        
        ownerFinancial.debts.push({
          patientId: patientId,
          doctorId: doctorId,
          amount: ptCost,
          description: `علاج طبيعي: ${followUpData.ptTreatment || 'Treatment'} - Follow-up Visit #${savedFollowUp.visitNumber}${muscleInfo} (د. ${doctorName})`,
          date: new Date(),
          status: 'pending'
        });
        
        await ownerFinancial.save();
        console.log(`✅ Follow-up PT cost added as patient debt on clinic owner ${financialOwnerId}:`, ptCost);
      } catch (debtErr) {
        console.error('Error adding follow-up PT cost as debt:', debtErr);
      }
    }

    // Handle consultation fee - add to patient's debt (stored in clinic owner's financial record)
    const consultationFee = followUpData.consultationFee ? parseFloat(followUpData.consultationFee) : 0;
    if (consultationFee > 0 && !isNaN(consultationFee) && isFinite(consultationFee)) {
      try {
        const doctorId = followUpData.doctor || parentRecord.doctor;
        const patientId = parentRecord.patient;
        
        const User = require('../models/User');
        const Clinic = require('../models/Clinic');
        
        // Get doctor info for the description
        const doctorUser = await User.findById(doctorId);
        const doctorName = doctorUser?.fullName || 'طبيب';
        
        // Find the clinic this doctor belongs to
        let clinic = null;
        if (doctorUser?.clinicId) {
          clinic = await Clinic.findById(doctorUser.clinicId);
        }
        if (!clinic) {
          clinic = await Clinic.findOne({
            $or: [
              { ownerId: doctorId },
              { 'doctors.doctorId': doctorId, 'doctors.status': 'active' }
            ]
          });
        }
        
        // Save debt to clinic owner's financial record
        const financialOwnerId = clinic ? clinic.ownerId : doctorId;
        
        let ownerFinancial = await Financial.findOne({ doctorId: financialOwnerId });
        if (!ownerFinancial) {
          ownerFinancial = new Financial({ doctorId: financialOwnerId, transactions: [], expenses: [], debts: [] });
        }
        
        ownerFinancial.debts.push({
          patientId: patientId,
          doctorId: doctorId,
          amount: consultationFee,
          description: `قيمة كشف - متابعة زيارة #${savedFollowUp.visitNumber} (د. ${doctorName})`,
          date: new Date(),
          status: 'pending'
        });
        
        await ownerFinancial.save();
        console.log(`✅ Follow-up consultation fee added as patient debt on clinic owner ${financialOwnerId}:`, consultationFee);
      } catch (debtErr) {
        console.error('Error adding follow-up consultation fee as debt:', debtErr);
      }
    }

    // Update the parent/root record's follow-up date to the new follow-up date
    // This keeps the main record's next follow-up date in sync
    if (followUpData.followUpDate) {
      await MedicalRecord.findByIdAndUpdate(rootRecordId, {
        followUpDate: new Date(followUpData.followUpDate)
      });
    }

    // Create follow-up appointment if appointment details provided
    let createdAppointment = null;
    if (followUpData.appointmentDate && followUpData.appointmentTimeSlot) {
      try {
        const Appointment = require('../models/Appointment');
        const User = require('../models/User');
        const Notification = require('../models/Notification');
        const { sendDoctorWhatsAppMessage } = require('../services/doctorWhatsappService');

        // Parse appointment date and time
        const appointmentDate = new Date(followUpData.appointmentDate);
        const [startTime, endTime] = followUpData.appointmentTimeSlot.split('-').map(t => t.trim());
        
        // Combine date and time
        const [startHour, startMin] = startTime.split(':').map(Number);
        appointmentDate.setHours(startHour, startMin, 0, 0);

        if (appointmentDate > new Date()) {
          const doctor = await User.findById(savedFollowUp.doctor);
          
          // Use selected workplace or fallback to first one
          let selectedWorkplace = null;
          if (followUpData.workplaceIndex !== undefined && doctor?.workplaces?.[followUpData.workplaceIndex]) {
            selectedWorkplace = doctor.workplaces[followUpData.workplaceIndex];
          } else if (followUpData.workplaceName) {
            selectedWorkplace = doctor?.workplaces?.find(w => w.name === followUpData.workplaceName);
          }
          if (!selectedWorkplace && doctor?.workplaces?.[0]) {
            selectedWorkplace = doctor.workplaces[0];
          }

          if (selectedWorkplace) {
            // Check if appointment already exists at this time
            const existingAppointment = await Appointment.findOne({
              doctorId: savedFollowUp.doctor,
              appointmentDateTime: appointmentDate,
              status: { $nin: ['cancelled'] }
            });

            if (!existingAppointment) {
              const followUpAppointment = new Appointment({
                doctorId: savedFollowUp.doctor,
                patient: savedFollowUp.patient,
                appointmentDateTime: appointmentDate,
                durationMinutes: followUpData.durationMinutes || 30,
                workplaceName: selectedWorkplace.name,
                workplaceAddress: selectedWorkplace.address,
                reason: `Follow-up: ${savedFollowUp.diagnosis || 'متابعة'}`,
                notes: `Follow-up visit #${savedFollowUp.visitNumber}`,
                urgency: 'normal',
                status: 'confirmed',
                relatedMedicalRecord: savedFollowUp._id
              });

              createdAppointment = await followUpAppointment.save();

              // Update follow-up record with appointment reference
              await MedicalRecord.findByIdAndUpdate(savedFollowUp._id, {
                followUpAppointment: createdAppointment._id
              });

              // Create notification for doctor
              const patientAccount = await User.findById(savedFollowUp.patient);
              await Notification.create({
                user: savedFollowUp.doctor,
                type: 'appointment',
                message: `تم إنشاء موعد متابعة مع ${patientAccount?.fullName || 'المريض'}`,
                relatedId: createdAppointment._id
              });

              // Send WhatsApp message to patient
              if (patientAccount?.mobileNumber && doctor) {
                try {
                  // Format date and time in Arabic
                  const dateStr = appointmentDate.toLocaleDateString('ar-EG', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  });
                  const timeSlotStr = `${startTime} - ${endTime}`;
                  
                  const whatsappMessage = `مرحباً ${patientAccount.fullName || ''}،\n\nلديك موعد متابعة في تاريخ ${dateStr} من ${timeSlotStr} في ${selectedWorkplace.name}.\n\nمع تحيات عيادة د. ${doctor.fullName || ''}`;
                  
                  console.log('Attempting to send WhatsApp message:', {
                    doctorId: doctor._id.toString(),
                    patientMobile: patientAccount.mobileNumber,
                    messageLength: whatsappMessage.length
                  });
                  
                  await sendDoctorWhatsAppMessage(doctor._id.toString(), patientAccount.mobileNumber, whatsappMessage);
                  console.log('✅ WhatsApp follow-up appointment message sent successfully');
                } catch (whatsappErr) {
                  console.error('❌ Failed to send WhatsApp message for follow-up appointment:', whatsappErr.message || whatsappErr);
                  // Don't fail the whole operation if WhatsApp fails
                }
              } else {
                console.log('⚠️ Cannot send WhatsApp - missing data:', {
                  hasMobile: !!patientAccount?.mobileNumber,
                  hasDoctor: !!doctor,
                  patientMobile: patientAccount?.mobileNumber
                });
              }
            }
          }
        }
      } catch (appointmentErr) {
        console.error('Error creating follow-up appointment:', appointmentErr);
      }
    }

    // Populate and return
    const populatedFollowUp = await MedicalRecord.findById(savedFollowUp._id)
      .populate('doctor', 'fullName specialty')
      .populate('patient', 'fullName mobileNumber')
      .populate('followUpAppointment');

    // Calculate total remaining debt for the patient (from clinic owner's financial)
    let totalPatientDebt = 0;
    try {
      const doctorId = followUpData.doctor || parentRecord.doctor;
      const patientId = parentRecord.patient;
      
      const User = require('../models/User');
      const Clinic = require('../models/Clinic');
      
      // Find the clinic this doctor belongs to
      const doctorUser = await User.findById(doctorId);
      let clinic = null;
      if (doctorUser?.clinicId) {
        clinic = await Clinic.findById(doctorUser.clinicId);
      }
      if (!clinic) {
        clinic = await Clinic.findOne({
          $or: [
            { ownerId: doctorId },
            { 'doctors.doctorId': doctorId, 'doctors.status': 'active' }
          ]
        });
      }
      const financialOwnerId = clinic ? clinic.ownerId : doctorId;
      
      // Check clinic owner's financial for debts
      const ownerFinancial = await Financial.findOne({ doctorId: financialOwnerId });
      if (ownerFinancial && ownerFinancial.debts) {
        totalPatientDebt += ownerFinancial.debts
          .filter(d => d.patientId && d.patientId.toString() === patientId.toString() && d.status === 'pending')
          .reduce((sum, d) => sum + (d.amount || 0), 0);
      }
      
      // Also check doctor's own financial for old debts (backwards compatibility)
      if (financialOwnerId.toString() !== doctorId.toString()) {
        const doctorFinancial = await Financial.findOne({ doctorId: doctorId });
        if (doctorFinancial && doctorFinancial.debts) {
          totalPatientDebt += doctorFinancial.debts
            .filter(d => d.patientId && d.patientId.toString() === patientId.toString() && d.status === 'pending')
            .reduce((sum, d) => sum + (d.amount || 0), 0);
        }
      }
    } catch (debtCalcErr) {
      console.error('Error calculating total patient debt:', debtCalcErr);
    }

    res.status(201).json({ 
      ...populatedFollowUp.toObject(),
      appointmentCreated: !!createdAppointment,
      totalPatientDebt: totalPatientDebt
    });
  } catch (err) {
    console.error('Error creating follow-up record:', err);
    res.status(500).json({ message: 'Server error creating follow-up record' });
  }
});

// GET follow-ups for a specific record
router.get('/:recordId/followups', async (req, res) => {
  try {
    const { recordId } = req.params;

    const followUps = await MedicalRecord.find({ parentRecord: recordId })
      .populate('doctor', 'fullName specialty')
      .sort({ visitNumber: 1, date: 1 });

    res.json(followUps);
  } catch (err) {
    console.error('Error fetching follow-ups:', err);
    res.status(500).json({ message: 'Server error fetching follow-ups' });
  }
});

// DELETE a medical record (only follow-up records can be deleted)
router.delete('/:recordId', async (req, res) => {
  try {
    const { recordId } = req.params;

    // Find the record to delete
    const record = await MedicalRecord.findById(recordId);
    if (!record) {
      return res.status(404).json({ message: 'Medical record not found' });
    }

    // Only allow deleting follow-up records (not initial records)
    if (record.recordType !== 'followup') {
      return res.status(403).json({ 
        message: 'Cannot delete initial medical records. Only follow-up records can be deleted.' 
      });
    }

    // Delete the linked appointment if it exists
    if (record.followUpAppointment) {
      try {
        const Appointment = require('../models/Appointment');
        await Appointment.findByIdAndDelete(record.followUpAppointment);
        console.log('Deleted linked follow-up appointment:', record.followUpAppointment);
      } catch (appointmentErr) {
        console.error('Error deleting linked appointment:', appointmentErr);
        // Continue with record deletion even if appointment deletion fails
      }
    }

    // Delete the follow-up record
    await MedicalRecord.findByIdAndDelete(recordId);

    // Optionally: Update visit numbers for remaining follow-ups
    // This keeps visit numbers sequential after deletion
    const remainingFollowUps = await MedicalRecord.find({
      parentRecord: record.parentRecord
    }).sort({ date: 1, visitNumber: 1 });

    // Renumber the remaining follow-ups (starting from 2, since 1 is the initial record)
    for (let i = 0; i < remainingFollowUps.length; i++) {
      await MedicalRecord.findByIdAndUpdate(remainingFollowUps[i]._id, {
        visitNumber: i + 2
      });
    }

    res.json({ 
      message: 'Follow-up record deleted successfully',
      deletedRecordId: recordId,
      appointmentDeleted: !!record.followUpAppointment
    });
  } catch (err) {
    console.error('Error deleting medical record:', err);
    res.status(500).json({ message: 'Server error deleting medical record' });
  }
});

module.exports = router;