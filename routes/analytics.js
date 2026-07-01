const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Appointment = require('../models/Appointment');

router.get('/', async (req, res) => {
  try {
    const [totalUsers, totalPatients, totalDoctors, totalPharmacies, totalAppointments] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ role: 'User' }),
      User.countDocuments({ role: 'Doctor' }),
      User.countDocuments({ role: 'Pharmacy' }),
      Appointment.countDocuments({}),
    ]);

    res.json({
      totalUsers,
      totalPatients,
      totalDoctors,
      totalPharmacies,
      totalAppointments,
    });
  } catch (error) {
    console.error('Error fetching analytics overview:', error);
    res.status(500).json({ message: 'Server error fetching analytics overview' });
  }
});

router.get('/patients', async (req, res) => {
  try {
    const { city, search } = req.query;
    const filter = { role: 'User' };

    if (city) filter.city = city;
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { mobileNumber: { $regex: search, $options: 'i' } },
        { idNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const patients = await User.find(filter)
      .select('-password -resetCode -phoneVerificationCode -twoFactorCode')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ patients, total: patients.length });
  } catch (error) {
    console.error('Error fetching patient analytics:', error);
    res.status(500).json({ message: 'Server error fetching patient analytics' });
  }
});

router.get('/revenue', async (req, res) => {
  try {
    const appointments = await Appointment.find({ isPaid: true }).select('paymentAmount appointmentFee paidAt createdAt').lean();
    const totalRevenue = appointments.reduce((sum, item) => sum + Number(item.paymentAmount || item.appointmentFee || 0), 0);
    res.json({ totalRevenue, payments: appointments });
  } catch (error) {
    console.error('Error fetching revenue analytics:', error);
    res.status(500).json({ message: 'Server error fetching revenue analytics' });
  }
});

router.get('/activity', async (req, res) => {
  try {
    const recentUsers = await User.find({})
      .select('fullName role createdAt')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    const recentAppointments = await Appointment.find({})
      .populate('doctorId', 'fullName')
      .populate('patient', 'fullName')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.json({ recentUsers, recentAppointments });
  } catch (error) {
    console.error('Error fetching activity analytics:', error);
    res.status(500).json({ message: 'Server error fetching activity analytics' });
  }
});

module.exports = router;
