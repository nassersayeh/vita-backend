// controllers/doctorsController.js
const User = require('../models/User');
const SPECIALTIES = require('../utils/specialties');

exports.getAllDoctors = async (req, res) => {
  try {
    // Query users with role === 'Doctor'
    const doctors = await User.find({ role: 'Doctor' });
    res.json(doctors);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching doctors.' });
  }
};

exports.getSpecialties = async (req, res) => {
  try {
    const lang = (req.query.lang === 'ar') ? 'ar' : 'en';
    const mapped = (SPECIALTIES.MAP || []).map((s) => ({
      key: s.key,
      value: s.en, // canonical value stored in DB and used in filters
      label: lang === 'ar' ? s.ar : s.en,
    }));
    res.json({ specialties: mapped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching specialties.' });
  }
};

exports.filterDoctors = async (req, res) => {
  try {
    const { city, specialty, q } = req.query;
    const filter = { role: 'Doctor' };
    if (city) filter.city = city;
    if (specialty) filter.specialty = specialty;
    const projection = 'fullName specialty city workplaces profileImage';
    let doctors = await User.find(filter).select(projection).lean();
    if (q) {
      const term = String(q).toLowerCase();
      doctors = doctors.filter(d => (d.fullName || '').toLowerCase().includes(term));
    }
    res.json({ doctors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error filtering doctors.' });
  }
};
exports.requestPatient = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { patientId } = req.body;
    // Fetch the doctor.
    const doctor = await User.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({ message: "Doctor not found." });
    }
    // Check if the patient is already in the doctor's patients list.
    if (doctor.patients && doctor.patients.includes(patientId)) {
      return res.status(400).json({ message: "Patient already exists." });
    }
    // Add the patient ID to the doctor's patients array.
    doctor.patients = doctor.patients ? [...doctor.patients, patientId] : [patientId];
    await doctor.save();
    res.json({ message: "Patient added successfully." });
  } catch (error) {
    console.error("Error requesting patient:", error);
    res.status(500).json({ message: "Server error while requesting patient." });
  }
};

exports.updateWorkplaces = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { workplaces } = req.body;

    if (!Array.isArray(workplaces)) {
      return res.status(400).json({ message: 'Workplaces must be an array.' });
    }

    const doctor = await User.findOneAndUpdate(
      { _id: doctorId, role: 'Doctor' },
      { $set: { workplaces } },
      { new: true, runValidators: true }
    );

    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found.' });
    }

    res.json({ message: 'Workplaces updated successfully.', doctor });
  } catch (error) {
    console.error('Error updating doctor workplaces:', error);
    res.status(500).json({ message: 'Server error while updating workplaces.' });
  }
};