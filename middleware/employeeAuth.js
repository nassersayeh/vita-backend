const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Employee = require('../models/Employee');

// Middleware to authenticate employee
const authenticateEmployee = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const user = await User.findById(decoded.userId);

    if (!user || user.role !== 'Employee') {
      return res.status(401).json({ message: 'Invalid token or not an employee' });
    }

    // Get employee record
    const employee = await Employee.findOne({ userId: user._id, isActive: true })
      .populate('employerId', 'fullName email');

    if (!employee) {
      return res.status(401).json({ message: 'Employee record not found or inactive' });
    }

    req.user = user;
    req.employee = employee;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Middleware to check specific permissions
const checkPermission = (requiredPermission) => {
  return (req, res, next) => {
    if (!req.employee || !req.employee.permissions) {
      return res.status(403).json({ message: 'Employee permissions not found' });
    }

    if (!req.employee.permissions[requiredPermission]) {
      return res.status(403).json({
        message: 'Insufficient permissions',
        required: requiredPermission
      });
    }

    next();
  };
};

// Middleware to check if employee belongs to the specified doctor
const verifyEmployeeDoctor = (req, res, next) => {
  const doctorId = req.params.doctorId || req.body.doctorId || req.query.doctorId;

  if (!doctorId) {
    return res.status(400).json({ message: 'Doctor ID required' });
  }

  if (req.employee.employerId.toString() !== doctorId.toString()) {
    return res.status(403).json({ message: 'You can only access data for your employer' });
  }

  next();
};

module.exports = {
  authenticateEmployee,
  checkPermission,
  verifyEmployeeDoctor
};