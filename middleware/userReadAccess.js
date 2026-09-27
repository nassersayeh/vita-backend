const auth = require('./auth');
const User = require('../models/User');
const { isAdmin } = require('./accountAuthorization');
const publicRoles = ['Doctor', 'Pharmacy', 'Lab', 'Radiology', 'Clinic', 'Hospital', 'Institution'];
const publicFields = 'fullName role specialty profileImage city country address mobileNumber workplaces workingSchedule consultationFee rating activationStatus';
const optionalAuth = (req, res, next) => req.headers.authorization ? auth(req, res, next) : next();
async function readUser(req, res) {
  try {
    const id = req.params.id || req.params.userId;
    if (!/^[a-f\d]{24}$/i.test(id)) return res.status(400).json({ message: 'Invalid account ID.' });
    let privateAccess = req.user && (isAdmin(req.user) || String(req.user._id) === id || (req.user.role === 'Doctor' && req.user.patients?.some(patient => String(patient) === id)));
    if (!privateAccess && req.user?.role === 'Doctor') privateAccess = Boolean(await require('../models/DoctorPatientRequest').exists({ doctor: req.user._id, patient: id, status: 'accepted' }));
    const filter = privateAccess ? { _id: id } : { _id: id, role: { $in: publicRoles }, isPublic: { $ne: false }, activationStatus: 'active' };
    const user = await User.findOne(filter).select(privateAccess ? '-password -resetCode -resetCodeExpiration -phoneVerificationCode -twoFactorCode' : publicFields);
    if (!user) return res.status(404).json({ message: 'Account not found.' });
    res.json(user);
  } catch { res.status(500).json({ message: 'Unable to load account.' }); }
}
module.exports = { optionalAuth, readUser, publicRoles, publicFields };
