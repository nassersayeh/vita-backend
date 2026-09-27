const isAdmin = user => ['Admin', 'Superadmin'].includes(user?.role);
const requireAdmin = (req, res, next) => isAdmin(req.user) ? next() : res.status(403).json({ message: 'Admin access required.' });
const ownerOrAdmin = param => (req, res, next) => isAdmin(req.user) || String(req.user?._id) === String(req.params[param])
  ? next() : res.status(403).json({ message: 'لا تملك صلاحية تعديل هذا الحساب.' });
module.exports = { requireAdmin, ownerOrAdmin, isAdmin };
