// Script to create a demo Clinic account
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect('mongodb+srv://nassersayeh:pop1990@cluster0.rsdkh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0')
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const User = require('./models/User');
const Clinic = require('./models/Clinic');

async function createDemoClinic() {
  try {
    // Check if demo clinic already exists
    const existingUser = await User.findOne({ mobileNumber: '+972501234567' });
    if (existingUser) {
      console.log('Demo clinic account already exists!');
      console.log('Mobile: +972501234567');
      console.log('Password: demo123');
      process.exit(0);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash('demo123', 10);

    // Create clinic user
    const clinicUser = new User({
      fullName: 'Demo Clinic',
      email: 'democlinic@vita.com',
      mobileNumber: '+972501234567',
      password: hashedPassword,
      role: 'Clinic',
      country: 'Palestine',
      city: 'Ramallah',
      address: '123 Main Street, Ramallah',
      idNumber: 'CLINIC-DEMO-001',
      isPhoneVerified: true, // Bypass OTP
      activationStatus: 'active', // Active account
      isPaid: true, // Paid subscription
      language: 'en'
    });

    await clinicUser.save();
    console.log('Clinic user created:', clinicUser._id);

    // Create clinic record
    const clinic = new Clinic({
      ownerId: clinicUser._id,
      name: 'Demo Medical Clinic',
      description: 'A demo clinic for testing purposes',
      maxDoctors: 10,
      doctors: [],
      settings: {
        allowDoctorFinancialView: true,
        allowDoctorPatientView: true,
        allowDoctorScheduleEdit: true,
        autoApproveAppointments: false
      },
      isActive: true
    });

    await clinic.save();
    console.log('Clinic record created:', clinic._id);

    console.log('\n========================================');
    console.log('Demo Clinic Account Created Successfully!');
    console.log('========================================');
    console.log('Mobile: +972501234567');
    console.log('Password: demo123');
    console.log('Email: democlinic@vita.com');
    console.log('========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('Error creating demo clinic:', error);
    process.exit(1);
  }
}

createDemoClinic();
