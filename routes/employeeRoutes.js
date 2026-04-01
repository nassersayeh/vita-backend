const express = require('express');
const router = express.Router();
const Employee = require('../models/Employee');
const User = require('../models/User');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticateEmployee, checkPermission, verifyEmployeeDoctor } = require('../middleware/employeeAuth');
const authMiddleware = require('../middleware/auth');

// Middleware to verify doctor owns the employee
const verifyEmployeeOwnership = async (req, res, next) => {
  try {
    const employee = await Employee.findById(req.params.employeeId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    if (employee.employerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You do not have permission to manage this employee' });
    }

    req.employee = employee;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get all employees for a doctor
router.get('/doctor/:doctorId', authMiddleware, async (req, res) => {
  try {
    const { doctorId } = req.params;

    // Verify the requesting user is the doctor or clinic owner
    if (req.user._id.toString() !== doctorId && req.user.role !== 'Clinic') {
      return res.status(403).json({ message: 'You can only view your own employees' });
    }

    const employees = await Employee.find({ employerId: doctorId, isActive: true })
      .populate('userId', 'fullName email mobileNumber profileImage')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      employees: employees.map(emp => ({
        _id: emp._id,
        userId: emp.userId,
        position: emp.position,
        hireDate: emp.hireDate,
        permissions: emp.permissions,
        isActive: emp.isActive,
        workingHours: emp.workingHours,
        notes: emp.notes
      }))
    });
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ message: 'Failed to fetch employees', error: error.message });
  }
});

// Create new employee
router.post('/doctor/:doctorId', authMiddleware, [
  body('fullName').isLength({ min: 2 }).withMessage('Full name must be at least 2 characters'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('mobileNumber').isLength({ min: 10 }).withMessage('Valid mobile number is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('position').isIn(['Receptionist', 'Nurse', 'Medical Assistant', 'Office Manager', 'Billing Specialist', 'Other']).withMessage('Invalid position'),
  body('permissions').isObject().withMessage('Permissions must be an object')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { doctorId } = req.params;
    const { fullName, email, mobileNumber, password, position, permissions, workingHours, notes } = req.body;

    // Verify the requesting user is the doctor or clinic
    if (req.user._id.toString() !== doctorId && req.user.role !== 'Clinic') {
      return res.status(403).json({ message: 'You can only create employees for yourself' });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    // Check if mobile number already exists
    const existingMobile = await User.findOne({ mobileNumber });
    if (existingMobile) {
      return res.status(400).json({ message: 'Mobile number already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate unique username for employee
    const baseUsername = fullName.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 10);
    let username = baseUsername;
    let counter = 1;
    
    // Ensure username is unique
    while (await User.findOne({ username })) {
      username = `${baseUsername}${counter}`;
      counter++;
      if (counter > 100) { // Prevent infinite loop
        username = `${baseUsername}_${Date.now()}`;
        break;
      }
    }

    // Create user account
    const newUser = new User({
      fullName,
      username, // ✅ Added unique username
      email,
      mobileNumber,
      password: hashedPassword,
      role: 'Employee',
      country: req.user.country,
      city: req.user.city,
      address: req.user.address,
      language: req.user.language,
      idNumber: mobileNumber, // Use mobile number as ID for employees
      activationStatus: 'active', // Employees are auto-activated
      isPaid: true, // Employees don't need separate payment
      trialEndDate: null // Employees don't have trial periods
    });

    await newUser.save();

    // Create employee record
    const newEmployee = new Employee({
      employerId: doctorId,
      userId: newUser._id,
      position,
      permissions,
      workingHours,
      notes
    });

    await newEmployee.save();

    // Populate and return the employee data
    const populatedEmployee = await Employee.findById(newEmployee._id)
      .populate('userId', 'fullName email mobileNumber profileImage');

    res.status(201).json({
      success: true,
      message: 'Employee created successfully',
      employee: {
        _id: populatedEmployee._id,
        userId: populatedEmployee.userId,
        position: populatedEmployee.position,
        hireDate: populatedEmployee.hireDate,
        permissions: populatedEmployee.permissions,
        workingHours: populatedEmployee.workingHours,
        notes: populatedEmployee.notes
      }
    });
  } catch (error) {
    console.error('Error creating employee:', error);
    res.status(500).json({ message: 'Failed to create employee', error: error.message });
  }
});

// Update employee permissions
router.put('/:employeeId/permissions', authMiddleware, verifyEmployeeOwnership, [
  body('permissions').isObject().withMessage('Permissions must be an object')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { permissions } = req.body;

    const employee = await Employee.findByIdAndUpdate(
      req.params.employeeId,
      { permissions },
      { new: true }
    ).populate('userId', 'fullName email mobileNumber profileImage');

    res.status(200).json({
      success: true,
      message: 'Employee permissions updated successfully',
      employee: {
        _id: employee._id,
        userId: employee.userId,
        position: employee.position,
        permissions: employee.permissions
      }
    });
  } catch (error) {
    console.error('Error updating employee permissions:', error);
    res.status(500).json({ message: 'Failed to update permissions', error: error.message });
  }
});

// Update employee details
router.put('/:employeeId', authMiddleware, verifyEmployeeOwnership, async (req, res) => {
  try {
    const { position, workingHours, notes, salary, permissions } = req.body;

    const updateData = { position, workingHours, notes, salary };
    if (permissions) {
      updateData.permissions = permissions;
    }

    const employee = await Employee.findByIdAndUpdate(
      req.params.employeeId,
      updateData,
      { new: true }
    ).populate('userId', 'fullName email mobileNumber profileImage');

    res.status(200).json({
      success: true,
      message: 'Employee updated successfully',
      employee: {
        _id: employee._id,
        userId: employee.userId,
        position: employee.position,
        workingHours: employee.workingHours,
        notes: employee.notes,
        salary: employee.salary,
        permissions: employee.permissions
      }
    });
  } catch (error) {
    console.error('Error updating employee:', error);
    res.status(500).json({ message: 'Failed to update employee', error: error.message });
  }
});

// Deactivate employee (soft delete)
router.delete('/:employeeId', authMiddleware, verifyEmployeeOwnership, async (req, res) => {
  try {
    await Employee.findByIdAndUpdate(req.params.employeeId, { isActive: false });

    res.status(200).json({
      success: true,
      message: 'Employee deactivated successfully'
    });
  } catch (error) {
    console.error('Error deactivating employee:', error);
    res.status(500).json({ message: 'Failed to deactivate employee', error: error.message });
  }
});

// Reactivate employee
router.post('/:employeeId/reactivate', authMiddleware, verifyEmployeeOwnership, async (req, res) => {
  try {
    await Employee.findByIdAndUpdate(req.params.employeeId, { isActive: true });

    res.status(200).json({
      success: true,
      message: 'Employee reactivated successfully'
    });
  } catch (error) {
    console.error('Error reactivating employee:', error);
    res.status(500).json({ message: 'Failed to reactivate employee', error: error.message });
  }
});

// Get current employee's permissions and data
router.get('/me', authenticateEmployee, async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user._id, isActive: true })
      .populate('employerId', 'fullName clinicName')
      .populate('userId', 'fullName email mobileNumber');

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    res.status(200).json({
      success: true,
      employee: {
        _id: employee._id,
        userId: employee.userId,
        employerId: employee.employerId,
        position: employee.position,
        hireDate: employee.hireDate,
        permissions: employee.permissions,
        workingHours: employee.workingHours,
        notes: employee.notes
      }
    });
  } catch (error) {
    console.error('Error fetching employee data:', error);
    res.status(500).json({ message: 'Failed to fetch employee data', error: error.message });
  }
});

module.exports = router;