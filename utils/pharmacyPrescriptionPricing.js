const activePrescriptionFilter = (now = new Date()) => ({
  isValid: true, dispensedAt: null, workflowStatus: { $ne: 'pending_secretary' },
  dispensedCount: { $in: [0, null] },
  $or: [{ expiryDate: null }, { expiryDate: { $gt: now } }],
});

function buildPrescriptionQuote(products, submittedItems) {
  if (!products.length || !Array.isArray(submittedItems) || submittedItems.length !== products.length) throw new Error('INVALID_PRICE');
  const byId = new Map(submittedItems.map(item => [String(item?.prescriptionProductId), item]));
  if (byId.size !== products.length) throw new Error('INVALID_PRICE');
  const items = products.map(product => {
    const submitted = byId.get(String(product._id));
    const valid = value => (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '' && Number.isFinite(Number(value));
    if (!valid(submitted?.originalPrice) || !valid(submitted?.discountedPrice) || Number(submitted.originalPrice) > 1000000 || Number(submitted.originalPrice) < 0 || Number(submitted.discountedPrice) < 0 || Number(submitted.discountedPrice) > Number(submitted.originalPrice)) throw new Error('INVALID_PRICE');
    const originalPrice = Number(Number(submitted.originalPrice).toFixed(2));
    const discountedPrice = Number(Number(submitted.discountedPrice).toFixed(2));
    const quantity = product.quantity ?? 1;
    if (originalPrice < 0 || discountedPrice < 0 || discountedPrice > originalPrice || !Number.isInteger(quantity) || quantity <= 0) throw new Error('INVALID_PRICE');
    return { prescriptionProductId: product._id, originalPrice, discountedPrice,
      discountPercentage: originalPrice ? Number(((originalPrice - discountedPrice) / originalPrice * 100).toFixed(2)) : 0,
      vitaCommission: Number((discountedPrice * quantity * 0.02).toFixed(2)) };
  });
  const totals = items.reduce((sum, item, index) => {
    const quantity = products[index].quantity ?? 1;
    sum.original += item.originalPrice * quantity;
    sum.discounted += item.discountedPrice * quantity;
    sum.commission += item.vitaCommission;
    return sum;
  }, { original: 0, discounted: 0, commission: 0 });
  if (![totals.original, totals.discounted, totals.commission].every(value => Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER / 100)) throw new Error('INVALID_PRICE');
  return { items, originalTotal: Number(totals.original.toFixed(2)), discountedTotal: Number(totals.discounted.toFixed(2)), vitaCommissionTotal: Number(totals.commission.toFixed(2)) };
}
module.exports = { activePrescriptionFilter, buildPrescriptionQuote };
