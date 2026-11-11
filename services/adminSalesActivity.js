const User = require('../models/User');
const Prescription = require('../models/EPrescription');
const Controlled = require('../models/ControlledPrescription');
const Quote = require('../models/PharmacyPrescriptionQuote');
const ControlledQuote = require('../models/ControlledQuote');
const LabRequest = require('../models/LabRequest');
const MedicalExamRequest = require('../models/MedicalExamRequest');
const ImageRequest = require('../models/ImageRequest');
const Order = require('../models/Order');

const personFields = 'fullName role mobileNumber idNumber specialty city address email country';
const people = paths => paths.map(path => ({ path, select: personFields }));
const rxFields = 'patientId doctorId clinicId workflowStatus routedBy routedTo routedAt distributionChannel products medicalTests isValid expiryDate validityType validityPeriod dispensedCount dispensedAt dispensedBy dispensingNotes renewalRequests diagnosis notes date prescriptionNumber priority createdAt updatedAt';
const definitions = {
  prescriptions: { Model: Prescription, Quote, fields: rxFields, owners: ['doctorId', 'patientId', 'dispensedBy', 'routedTo'], populate: people(['patientId', 'doctorId', 'dispensedBy', 'routedBy', 'routedTo']), done: { $or: [{ dispensedAt: { $type: 'date' } }, { dispensedCount: { $gt: 0 } }] } },
  controlled: { Model: Controlled, Quote: ControlledQuote, fields: `${rxFields} serial issuedAt stoppedAt stoppedByName stoppedByRole stopReason audit patientSnapshot doctorSnapshot pharmacySnapshot`, owners: ['doctorId', 'patientId', 'dispensedBy', 'routedTo'], populate: people(['patientId', 'doctorId', 'dispensedBy', 'routedBy', 'routedTo']), base: { issuedAt: { $ne: null } }, done: { $or: [{ dispensedAt: { $type: 'date' } }, { dispensedCount: { $gt: 0 } }] } },
  exams: { Model: MedicalExamRequest, fields: 'doctorId patientId laboratoryId referredAt referredBy source tests notes status results pricing totalCost completedAt deletedAt createdAt updatedAt', owners: ['doctorId', 'patientId', 'laboratoryId'], populate: people(['doctorId', 'patientId', 'laboratoryId', 'referredBy']), done: { status: 'completed' } },
  diagnostics: { Model: LabRequest, fields: 'patientId doctorId labId testIds status requestDate scheduledDate completedDate notes results totalCost discount discountAmount originalCost vitaCommissionPercent vitaCommissionAmount providerNetAmount pricingItems approvalStatus approvedBy approvedAt rejectionReason isPaid paidAmount paidAt paidBy requestedBy sourceChannel clinicId testName createdAt updatedAt', owners: ['doctorId', 'patientId', 'labId', 'requestedBy'], populate: [...people(['patientId', 'doctorId', 'labId', 'requestedBy', 'approvedBy', 'paidBy']), { path: 'testIds', select: 'name type category price unit description' }, { path: 'pricingItems.testId', select: 'name type' }, { path: 'results.testId', select: 'name type' }], done: { status: 'completed' } },
  images: { Model: ImageRequest, fields: 'patientId doctorId imageType bodyPart status requestDate scheduledDate completedDate notes images radiologistNotes findings createdAt updatedAt', owners: ['doctorId', 'patientId'], populate: people(['patientId', 'doctorId']), done: { status: 'completed' } },
  orders: { Model: Order, fields: 'user pharmacyId city items total subtotal originalSubtotal originalTotal discountAmount discountPercentage vitaCommissionPercent vitaCommissionAmount pharmacyPricedAt deliveryFee status adminApprovalStatus adminApprovedAt adminApprovedBy adminRejectionReason acceptedAt preparingStartedAt deliveryAssignedAt shippedAt deliveredAt statusHistory paymentMethod insuranceCompany orderType prescriptionId prescriptionImage prescriptionNotes deliveryMethod deliveryAddress createdAt updatedAt', owners: ['user', 'pharmacyId'], populate: people(['user', 'pharmacyId', 'adminApprovedBy', 'statusHistory.changedBy']), done: { status: { $in: ['delivered', 'completed', 'paid'] } } },
};

async function getAdminSalesActivity(managerId, query = {}) {
  const type = query.type || 'prescriptions';
  const definition = definitions[type];
  if (!Object.hasOwn(definitions, type) || !['all', 'done', 'pending'].includes(query.execution || 'all')) {
    throw Object.assign(new Error('Invalid activity filter'), { status: 400 });
  }
  const customers = await User.find({ salesManager: managerId, role: { $in: ['Doctor', 'Pharmacy', 'User'] } }).select('_id').lean();
  const ids = customers.map(customer => customer._id);
  const page = Math.max(1, Math.min(100000, Number.parseInt(query.page, 10) || 1));
  const pageSize = 20;
  if (!ids.length) return { rows: [], total: 0, page, pageSize, type };
  const scope = definition.owners.map(field => ({ [field]: { $in: ids } }));
  // Include prescriptions priced by a customer pharmacy before they are dispensed.
  if (definition.Quote) {
    const quotedIds = await definition.Quote.distinct('prescription', { pharmacy: { $in: ids } });
    if (quotedIds.length) scope.push({ _id: { $in: quotedIds } });
  }
  const clauses = [{ $or: scope }, ...(definition.base ? [definition.base] : [])];
  if (query.execution === 'done') clauses.push(definition.done);
  if (query.execution === 'pending') clauses.push({ $nor: [definition.done] });
  const filter = { $and: clauses };
  const [rows, total] = await Promise.all([
    definition.Model.find(filter).select(definition.fields).populate(definition.populate).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    definition.Model.countDocuments(filter),
  ]);
  let quotes = [];
  if (definition.Quote && rows.length) quotes = await definition.Quote.find({ prescription: { $in: rows.map(row => row._id) } })
    .select('prescription pharmacy items originalTotal discountedTotal vitaCommissionTotal status createdAt updatedAt').populate({ path: 'pharmacy', select: personFields }).lean();
  return { rows: rows.map(row => ({ ...row, ...(definition.Quote ? { quotes: quotes.filter(quote => String(quote.prescription) === String(row._id)) } : {}) })), total, page, pageSize, type };
}
module.exports = { getAdminSalesActivity };
