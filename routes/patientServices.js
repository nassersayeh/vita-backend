const router = require('express').Router();
const User = require('../models/User');
const MedicalTest = require('../models/MedicalTest');
const LabRequest = require('../models/LabRequest');
const { serviceFilter, serviceTotals } = require('../utils/patientServiceBooking');
const validId = (value) => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const providerFilter = (type) => ({
  role: type === 'radiology' ? 'Radiology' : 'Lab',
  activationStatus: 'active',
  isPublic: { $ne: false },
});
router.use(require('../middleware/auth'));
router.use((req, res, next) =>
  req.user.role === 'User'
    ? next()
    : res.status(403).json({ message: 'Patient account required.' }),
);
router.use((req, res, next) =>
  ['laboratory', 'radiology'].includes(req.query.type || req.body?.type)
    ? next()
    : res.status(400).json({ message: 'Invalid service type.' }),
);

router.get('/centers', async (req, res) => {
  try {
    const centers = await User.find(providerFilter(req.query.type))
      .select('fullName city address profileImage')
      .sort({ fullName: 1 })
      .lean();
    res.json({ centers });
  } catch {
    res.status(500).json({ message: 'Unable to load centers.' });
  }
});
router.get('/centers/:centerId/services', async (req, res) => {
  if (!validId(req.params.centerId)) return res.status(400).json({ message: 'Invalid center.' });
  try {
    const center = await User.findOne({
      _id: req.params.centerId,
      ...providerFilter(req.query.type),
    })
      .select('_id')
      .lean();
    if (!center) return res.status(404).json({ message: 'Center unavailable.' });
    const services = await MedicalTest.find(serviceFilter(center._id, req.query.type))
      .select('name category description price preparationInstructions estimatedDuration')
      .sort({ name: 1 })
      .lean();
    res.json({ services, discount: 20 });
  } catch {
    res.status(500).json({ message: 'Unable to load center services.' });
  }
});
router.post('/requests', async (req, res) => {
  const { centerId, testIds, type, notes = '' } = req.body;
  if (
    !validId(centerId) ||
    !Array.isArray(testIds) ||
    !testIds.length ||
    testIds.length > 30 ||
    testIds.some((id) => !validId(id)) ||
    new Set(testIds).size !== testIds.length ||
    typeof notes !== 'string' ||
    notes.length > 2000
  ) {
    return res.status(400).json({ message: 'Select a center and between 1 and 30 services.' });
  }
  try {
    const center = await User.findOne({ _id: centerId, ...providerFilter(type) })
      .select('_id')
      .lean();
    if (!center) return res.status(404).json({ message: 'Center unavailable.' });
    const services = await MedicalTest.find({
      ...serviceFilter(center._id, type),
      _id: { $in: testIds },
    })
      .select('name price')
      .lean();
    if (services.length !== testIds.length)
      return res
        .status(400)
        .json({ message: 'Some selected services are no longer offered by this center.' });
    const request = await LabRequest.create({
      patientId: req.user._id,
      requestedBy: req.user._id,
      labId: center._id,
      testIds,
      notes: notes.trim(),
      status: 'pending',
      approvalStatus: 'approved',
      sourceChannel: 'vita_partner_network',
      ...serviceTotals(services),
    });
    res.status(201).json({ request });
  } catch (error) {
    res
      .status(error.status || 500)
      .json({ message: error.status ? error.message : 'Unable to submit request.' });
  }
});
module.exports = router;
