const { buildPatientOrderQuote } = require('./patientOrderQuote');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
async function dispenseUploadedOrder({ orderId, pharmacy, lines }, models = {}) {
  const Order = models.Order || require('../models/Order');
  const Drug = models.Drug || require('../models/Drug');
  const guard = models.guard || require('./ordinaryControlledGuard').assertOrdinaryAllowed;
  if (pharmacy?.role !== 'Pharmacy' || pharmacy.activationStatus !== 'active' || pharmacy.patientOrderingEnabled === false || pharmacy.prescriptionDispensingEnabled !== true) fail('This pharmacy cannot dispense patient orders.', 403);
  if (!/^[a-f\d]{24}$/i.test(String(orderId))) fail('Invalid order.');
  const filter = { _id: orderId, pharmacyId: pharmacy._id, orderType: 'upload', adminApprovalStatus: 'approved', status: 'pending', dispensedAt: null };
  const order = await Order.findOne(filter).lean();
  if (!order) fail('This uploaded order is unavailable or has already been dispensed.', 409);
  if (!order.prescriptionImage?.fileUrl) fail('An attached prescription or medicine photo is required.');
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) fail('Add at least one medicine (maximum 100).');
  const ids = new Set();
  for (const line of lines) {
    if (!line || !/^[a-f\d]{24}$/i.test(String(line.drugId)) || ids.has(String(line.drugId))) fail('Select each medicine once from the drug catalog.');
    ids.add(String(line.drugId));
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 10000) fail('Enter a valid whole quantity.');
    if (!['number', 'string'].includes(typeof line.price) || String(line.price).trim() === '' || !Number.isFinite(Number(line.price)) || Number(line.price) < 0 || Number(line.price) > 1000000) fail('Enter a valid unit price.');
    if (Math.abs(Number(line.price) * 100 - Math.round(Number(line.price) * 100)) > 0.000001) fail('Unit prices can have at most two decimal places.');
    const originalPrice = line.originalPrice === undefined ? line.price : line.originalPrice;
    if (!['number', 'string'].includes(typeof originalPrice) || String(originalPrice).trim() === '' || !Number.isFinite(Number(originalPrice)) || Number(originalPrice) < 0 || Number(originalPrice) > 1000000 || Math.abs(Number(originalPrice) * 100 - Math.round(Number(originalPrice) * 100)) > 0.000001) fail('Enter a valid unit price before discount.');
    if (Number(line.price) > Number(originalPrice)) fail('The discounted unit price cannot exceed the original price.');
    if (typeof line.isSubstitute !== 'boolean') fail('Specify whether this medicine is a substitute.');
    if (line.originalDrugName != null && (typeof line.originalDrugName !== 'string' || line.originalDrugName.trim().length > 300)) fail('The original medicine name must be at most 300 characters.');
  }
  const drugs = await Drug.find({ _id: { $in: [...ids] }, isActive: true }).select('_id name').lean();
  const byId = new Map(drugs.map(drug => [String(drug._id), drug]));
  const items = lines.map(line => {
    const drug = byId.get(String(line.drugId));
    if (!drug) fail('A selected medicine is no longer available in the catalog.');
    return { onModel: 'Product', item: drug._id, drugId: drug._id, name: drug.name, quantity: line.quantity,
      originalPrice: Number(line.originalPrice === undefined ? line.price : line.originalPrice), price: Number(line.price), isSubstitute: line.isSubstitute, originalDrugName: line.isSubstitute ? (line.originalDrugName || '').trim() : '',
      details: { drugId: drug._id, source: 'uploaded_prescription' } };
  });
  await guard(items, pharmacy);
  const quote = buildPatientOrderQuote(items, items.map((item, index) => ({ index, originalPrice: item.originalPrice, discountedPrice: item.price })), Number(order.deliveryFee || 0));
  const now = new Date();
  // One conditional write prevents retries and concurrent tabs from dispensing twice.
  const updated = await Order.findOneAndUpdate(filter, { $set: { ...quote, status: 'completed', pharmacyPricedAt: now,
    dispensedAt: now, dispensedBy: pharmacy._id, acceptedAt: now, deliveredAt: now },
    $push: { statusHistory: { status: 'completed', changedAt: now, changedBy: pharmacy._id, notes: 'Uploaded prescription medicines dispensed by pharmacy.' } } }, { new: true, runValidators: true });
  if (!updated) fail('This order changed or was already dispensed. Refresh and retry.', 409);
  return updated;
}
module.exports = { dispenseUploadedOrder };
