const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Payment = require('../models/Payment');
const Order = require('../models/Order');


// New route to search users by email
router.get('/userbyemail', async (req, res) => { 
    try {
      const { email } = req.query;
      const query = email ? { email: new RegExp(`^${email.trim()}$`, 'i') } : {};
      const users = await User.find(query)
      console.log(users)
      res.status(200).json(users);
    } catch (error) {
      res.status(500).json({ message: 'خطأ في البحث عن المستخدمين بالبريد الإلكتروني.' });
    }
  });

router.get('/allusers',  async (req, res) => {
  console.log('hiiii')
  try {
    const users = await User.find();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب المستخدمين.' });
  }
});

router.get('/users/search',  async (req, res) => {
  try {
    const { keyword } = req.query;
    const query = keyword ? { fullName: new RegExp(keyword, 'i') } : {};
    const users = await User.find(query).select('-password');
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في البحث عن المستخدمين.' });
  }
});

router.put('/users/:id/status',  async (req, res) => {
  try {
    const { activationStatus } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { activationStatus }, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود.' });
    res.status(200).json({ message: 'تم تحديث حالة المستخدم.', user });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تحديث حالة المستخدم.' });
  }
});

router.put('/users/:id/role',  async (req, res) => {
  try {
    const { role } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود.' });
    res.status(200).json({ message: 'تم تحديث الدور.', user });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تحديث الدور.' });
  }
});

router.delete('/users/:id',  async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود.' });
    res.status(200).json({ message: 'تم حذف المستخدم.' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في حذف المستخدم.' });
  }
});

router.get('/payments',  async (req, res) => {
  try {
    const payments = await Payment.find().populate('user', 'fullName');
    res.status(200).json(payments);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب المدفوعات.' });
  }
});

router.get('/payments/search',  async (req, res) => {
  try {
    const { keyword } = req.query;
    const query = keyword ? { 'userName': new RegExp(keyword, 'i') } : {};
    const payments = await Payment.find(query).populate('user', 'fullName');
    res.status(200).json(payments);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في البحث عن المدفوعات.' });
  }
});

router.delete('/payments/:id',  async (req, res) => {
  try {
    const payment = await Payment.findByIdAndDelete(req.params.id);
    if (!payment) return res.status(404).json({ message: 'المدفوعة غير موجودة.' });
    res.status(200).json({ message: 'تم حذف المدفوعة.' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في حذف المدفوعة.' });
  }
});

router.get('/orders',  async (req, res) => {
  try {
    const orders = await Order.find().populate('user', 'fullName');
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب الطلبات.' });
  }
});

router.get('/orders/search',  async (req, res) => {
  try {
    const { keyword } = req.query;
    const query = keyword ? { 'userName': new RegExp(keyword, 'i') } : {};
    const orders = await Order.find(query).populate('user', 'fullName');
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في البحث عن الطلبات.' });
  }
});

router.delete('/orders/:id',  async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ message: 'الطلب غير موجود.' });
    res.status(200).json({ message: 'تم حذف الطلب.' });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في حذف الطلب.' });
  }
});

router.put('/profile/:id',  async (req, res) => {
  console.log('userId ')
  try {
    const userId = req.params.id;
    const updates = req.body;

    if (!updates.fullName || !updates.country || !updates.city || !updates.idNumber || !updates.address) {
      return res.status(400).json({ message: 'يرجى ملء الحقول المطلوبة.' });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true, runValidators: true }
    );


    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود.' });
    }

    res.status(200).json({ message: 'تم تحديث الملف الشخصي بنجاح.', user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'خطأ في الخادم أثناء تحديث الملف الشخصي.' });
  }
});

module.exports = router;
// Get patient history - medical data from user profile
router.get('/patient-history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Find the user and populate relevant medical history
    const user = await User.findById(userId).select('-password -resetCode -resetCodeExpiration');
    
    if (!user) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    
    // Extract medical history from user profile
    const patientHistory = {
      personalInfo: {
        fullName: user.fullName,
        birthdate: user.birthdate,
        sex: user.sex,
        bloodType: user.bloodType,
        height: user.height,
        weight: user.weight,
        emergencyContact: user.emergencyContact
      },
      medicalInfo: {
        allergies: user.allergies || [],
        pastIllnesses: user.pastIllnesses || [],
        bloodType: user.bloodType,
        height: user.height,
        weight: user.weight
      },
      contactInfo: {
        mobileNumber: user.mobileNumber,
        email: user.email,
        address: user.address,
        city: user.city,
        country: user.country
      },
      lastUpdated: user.updatedAt || user.createdAt
    };
    
    res.status(200).json({
      success: true,
      data: patientHistory
    });
  } catch (error) {
    console.error('Error fetching patient history:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while fetching patient history' 
    });
  }
});

// Update patient medical history
router.put('/patient-history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { allergies, pastIllnesses, bloodType, height, weight, emergencyContact } = req.body;
    
    const updateData = {};
    if (allergies !== undefined) updateData.allergies = allergies;
    if (pastIllnesses !== undefined) updateData.pastIllnesses = pastIllnesses;
    if (bloodType !== undefined) updateData.bloodType = bloodType;
    if (height !== undefined) updateData.height = height;
    if (weight !== undefined) updateData.weight = weight;
    if (emergencyContact !== undefined) updateData.emergencyContact = emergencyContact;
    
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password -resetCode -resetCodeExpiration');
    
    if (!user) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    
    res.status(200).json({
      success: true,
      message: 'Patient history updated successfully',
      data: user
    });
  } catch (error) {
    console.error('Error updating patient history:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while updating patient history' 
    });
  }
});
