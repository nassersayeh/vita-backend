/** Cancelled/declined requests release the prescription unless fulfillment occurred. */
exports.prescriptionBlockingOrders = () => ({
  $nor: [{ status: { $in: ['cancelled', 'declined'] }, 'statusHistory.status': { $nin: ['delivered', 'completed', 'paid'] } }],
});
exports.orderablePrescriptionFilter = (usedIds, now = new Date()) => ({
  isValid: true,
  $and: [
    { $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }] },
    { $or: [
      { validityType: { $ne: 'one-time' } },
      { _id: { $nin: usedIds }, dispensedAt: null, dispensedCount: { $in: [0, null] } },
    ] },
  ],
});

exports.annotatePatientPrescription = (prescription, usedIds) => {
  const value = prescription.toObject ? prescription.toObject() : prescription;
  return { ...value, alreadyOrdered: value.validityType === 'one-time' && usedIds.has(String(value._id)) };
};
