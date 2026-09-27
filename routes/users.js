// routes/users.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');

router.get('/', async (req, res) => {
  try {
    const role = req.query.role;
    if (!require('../middleware/userReadAccess').publicRoles.includes(role)) {
      return res.status(400).json({ message: 'Role query parameter is required.' });
    }
    // Support legacy clients while keeping credentials out of the response.
    const users = await User.find({ role: new RegExp(`^${role}$`, 'i'), isPublic: { $ne: false } }).select(require('../middleware/userReadAccess').publicFields);
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching users.' });
  }
});

router.get('/:userId', require('../middleware/userReadAccess').optionalAuth, require('../middleware/userReadAccess').readUser);

router.get('/userids', async (req, res) => {
  try {
    const { ids } = req.query;
    const idArray = ids ? ids.split(',') : [];

    // Validate and filter valid ObjectIds
    const validIds = idArray.filter(id => mongoose.Types.ObjectId.isValid(id));

    if (!validIds.length) {
      return res.status(400).json({ message: 'لا يوجد معرفات صالحة' });
    }

    // Fetch users with valid IDs
    const users = await User.find({ _id: { $in: validIds } }, 'fullName').lean();
    const usersMap = users.reduce((acc, user) => ({
      ...acc,
      [user._id.toString()]: user.fullName || 'مستخدم مجهول',
    }), {});

    res.json(usersMap); // Return a map of id to fullName
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'خطأ في جلب بيانات المستخدمين' });
  }
});


module.exports = router;
