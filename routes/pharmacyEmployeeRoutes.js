const express = require('express');
const router = express.Router();
const PharmacyEmployee = require('../models/PharmacyEmployee');
const User = require('../models/User');
const auth = require('../middleware/auth');
const bcrypt = require('bcryptjs');

// Get all employees for a pharmacy
router.get('/pharmacy/:pharmacyId', auth, async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    
    // Verify the user is the pharmacy owner
    if (req.user._id.toString() !== pharmacyId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to view these employees' });
    }
    
    const employees = await PharmacyEmployee.find({ pharmacyId })
      .populate('userId', 'fullName email mobileNumber profileImage')
      .sort({ createdAt: -1 });
    
    res.json({ employees });
  } catch (error) {
    console.error('Error fetching pharmacy employees:', error);
    res.status(500).json({ message: 'Failed to fetch employees', error: error.message });
  }
});

// Create a new employee for a pharmacy
router.post('/pharmacy/:pharmacyId', auth, async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { fullName, email, mobileNumber, password, position, permissions, workingHours, salary, notes } = req.body;
    
    // Verify the user is the pharmacy owner
    if (req.user._id.toString() !== pharmacyId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to add employees' });
    }
    
    // Validate required fields
    if (!fullName || !email || !mobileNumber || !password) {
      return res.status(400).json({ message: 'Full name, email, phone, and password are required' });
    }
    
    // Check if user with this email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'A user with this email already exists' });
    }
    
    // Check if user with this mobile number already exists
    const existingPhone = await User.findOne({ mobileNumber });
    if (existingPhone) {
      return res.status(400).json({ message: 'A user with this phone number already exists' });
    }
    
    // Create the user account for the employee
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      fullName,
      email: email.toLowerCase(),
      mobileNumber,
      password: hashedPassword,
      role: 'Employee',
      country: 'Israel',
      city: 'Unknown',
      idNumber: mobileNumber, // Use mobile as idNumber for now
      address: 'Unknown',
      isPhoneVerified: true
    });
    await newUser.save();
    
    // Create the employee record
    const employee = new PharmacyEmployee({
      pharmacyId,
      userId: newUser._id,
      position: position || 'Pharmacist Assistant',
      permissions: permissions || {},
      workingHours: workingHours || {
        start: '09:00',
        end: '17:00',
        days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday']
      },
      salary,
      notes
    });
    await employee.save();
    
    // Populate the employee for response
    const populatedEmployee = await PharmacyEmployee.findById(employee._id)
      .populate('userId', 'fullName email mobileNumber');
    
    res.status(201).json({ 
      message: 'Employee created successfully',
      employee: populatedEmployee
    });
  } catch (error) {
    console.error('Error creating pharmacy employee:', error);
    res.status(500).json({ message: 'Failed to create employee', error: error.message });
  }
});

// Update employee details
router.put('/:employeeId', auth, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { position, permissions, workingHours, salary, notes } = req.body;
    
    const employee = await PharmacyEmployee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    // Verify the user is the pharmacy owner
    if (req.user._id.toString() !== employee.pharmacyId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to update this employee' });
    }
    
    // Update fields
    if (position) employee.position = position;
    if (permissions) employee.permissions = permissions;
    if (workingHours) employee.workingHours = workingHours;
    if (salary) employee.salary = salary;
    if (notes !== undefined) employee.notes = notes;
    
    await employee.save();
    
    const populatedEmployee = await PharmacyEmployee.findById(employee._id)
      .populate('userId', 'fullName email mobileNumber');
    
    res.json({ 
      message: 'Employee updated successfully',
      employee: populatedEmployee
    });
  } catch (error) {
    console.error('Error updating pharmacy employee:', error);
    res.status(500).json({ message: 'Failed to update employee', error: error.message });
  }
});

// Update employee permissions only
router.put('/:employeeId/permissions', auth, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { permissions } = req.body;
    
    const employee = await PharmacyEmployee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    // Verify the user is the pharmacy owner
    if (req.user._id.toString() !== employee.pharmacyId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to update permissions' });
    }
    
    employee.permissions = permissions;
    await employee.save();
    
    res.json({ message: 'Permissions updated successfully', employee });
  } catch (error) {
    console.error('Error updating employee permissions:', error);
    res.status(500).json({ message: 'Failed to update permissions', error: error.message });
  }
});

// Deactivate employee (soft delete)
router.delete('/:employeeId', auth, async (req, res) => {
  try {
    const { employeeId } = req.params;
    
    const employee = await PharmacyEmployee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    // Verify the user is the pharmacy owner
    if (req.user._id.toString() !== employee.pharmacyId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to deactivate this employee' });
    }
    
    employee.isActive = false;
    await employee.save();
    
    res.json({ message: 'Employee deactivated successfully' });
  } catch (error) {
    console.error('Error deactivating pharmacy employee:', error);
    res.status(500).json({ message: 'Failed to deactivate employee', error: error.message });
  }
});

// Reactivate employee
router.post('/:employeeId/reactivate', auth, async (req, res) => {
  try {
    const { employeeId } = req.params;
    
    const employee = await PharmacyEmployee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    // Verify the user is the pharmacy owner
    if (req.user._id.toString() !== employee.pharmacyId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to reactivate this employee' });
    }
    
    employee.isActive = true;
    await employee.save();
    
    res.json({ message: 'Employee reactivated successfully' });
  } catch (error) {
    console.error('Error reactivating pharmacy employee:', error);
    res.status(500).json({ message: 'Failed to reactivate employee', error: error.message });
  }
});

// Get current employee data (for employee dashboard)
router.get('/me', auth, async (req, res) => {
  try {
    if (req.user.role !== 'pharmacyEmployee') {
      return res.status(403).json({ message: 'Not a pharmacy employee' });
    }
    
    const employee = await PharmacyEmployee.findOne({ userId: req.user._id, isActive: true })
      .populate('pharmacyId', 'fullName email mobileNumber profileImage')
      .populate('userId', 'fullName email mobileNumber');
    
    if (!employee) {
      return res.status(404).json({ message: 'Employee record not found' });
    }
    
    res.json({ employee });
  } catch (error) {
    console.error('Error fetching employee data:', error);
    res.status(500).json({ message: 'Failed to fetch employee data', error: error.message });
  }
});

module.exports = router;
