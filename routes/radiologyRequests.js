const express = require('express');
const multer = require('multer');
const path = require('path');
const LabRequest = require('../models/LabRequest');
const MedicalTest = require('../models/MedicalTest');
const Financial = require('../models/Financial');

const router = express.Router();
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/lab-results/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => cb(null, [
    'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'application/dicom', 'application/octet-stream'
  ].includes(file.mimetype)),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const getRadiologyTestIds = async () => MedicalTest.find({ type: 'radiology' }).distinct('_id');

const findRadiologyRequest = async (requestId, centerId) => {
  const radiologyTestIds = await getRadiologyTestIds();
  return LabRequest.findOne({ _id: requestId, labId: centerId, testIds: { $in: radiologyTestIds } });
};

const recordRevenue = async (request) => {
  if (request.status !== 'completed' || !request.totalCost || !request.labId) return;
  const financial = await Financial.findOne({ doctorId: request.labId }) || new Financial({ doctorId: request.labId });
  const exists = financial.transactions.some((transaction) => transaction.labRequestId?.toString() === request._id.toString());
  if (exists) return;
  financial.totalEarnings = (financial.totalEarnings || 0) + request.totalCost;
  financial.transactions.push({ amount: request.totalCost, description: `إيراد طلب ${request._id}`, labRequestId: request._id, patientId: request.patientId, paymentMethod: 'Cash' });
  await financial.save();
};

router.get('/:centerId', async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const radiologyTestIds = await getRadiologyTestIds();
    const filter = { labId: req.params.centerId, testIds: { $in: radiologyTestIds } };
    if (req.query.status) filter.status = req.query.status;
    const [requests, total] = await Promise.all([
      LabRequest.find(filter).populate('patientId', 'fullName idNumber mobileNumber').populate('doctorId', 'fullName specialty').populate('testIds', 'name type category').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      LabRequest.countDocuments(filter),
    ]);
    res.json({ requests, total, currentPage: page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (error) {
    res.status(500).json({ message: 'Failed to load radiology requests' });
  }
});

router.put('/:centerId/:requestId/status', async (req, res) => {
  try {
    const request = await findRadiologyRequest(req.params.requestId, req.params.centerId);
    if (!request) return res.status(404).json({ message: 'Radiology request not found' });
    const { status, notes } = req.body;
    if (!['pending', 'in_progress', 'in-progress', 'completed', 'cancelled'].includes(status)) return res.status(400).json({ message: 'Invalid status' });
    request.status = status;
    if (notes !== undefined) request.notes = notes;
    if (status === 'completed') request.completedDate = new Date();
    await request.save();
    await recordRevenue(request);
    res.json(request);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update radiology request' });
  }
});

router.post('/:centerId/:requestId/files', upload.array('files', 20), async (req, res) => {
  try {
    const request = await findRadiologyRequest(req.params.requestId, req.params.centerId);
    if (!request) return res.status(404).json({ message: 'Radiology request not found' });
    if (!req.files?.length) return res.status(400).json({ message: 'No files uploaded' });
    request.results.push(...req.files.map(file => ({ result: `${req.protocol}://${req.get('host')}/uploads/lab-results/${file.filename}`, attachments: [file.filename], notes: req.body.notes || '' })));
    if (req.body.status === 'completed') { request.status = 'completed'; request.completedDate = new Date(); }
    await request.save();
    await recordRevenue(request);
    res.json({ message: 'Radiology files uploaded successfully', request });
  } catch (error) {
    res.status(500).json({ message: 'Failed to upload radiology files' });
  }
});

router.delete('/:centerId/:requestId', async (req, res) => {
  try {
    const request = await findRadiologyRequest(req.params.requestId, req.params.centerId);
    if (!request) return res.status(404).json({ message: 'Radiology request not found' });
    const financial = await Financial.findOne({ doctorId: request.labId });
    if (financial) {
      const linked = financial.transactions.filter(t => t.labRequestId?.toString() === request._id.toString() || t.labRequestIds?.some(id => id?.toString() === request._id.toString()) || String(t.description || '').includes(request._id.toString()));
      financial.totalEarnings = Math.max(0, (financial.totalEarnings || 0) - linked.reduce((sum, t) => sum + (Number(t.amount) || 0), 0));
      financial.transactions = financial.transactions.filter(t => !linked.includes(t));
      await financial.save();
    }
    await LabRequest.findByIdAndDelete(request._id);
    res.json({ message: 'Radiology request deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete radiology request' });
  }
});

module.exports = router;
