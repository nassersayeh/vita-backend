exports.serviceFilter = (providerId, type) => ({
  type,
  isActive: true,
  $or: [{ providerId }, { providerId: null, createdBy: providerId }],
});
exports.serviceTotals = (services, { discountPercent = 20, commissionPercent = 5 } = {}) => {
  if (![discountPercent, commissionPercent].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100)) throw Object.assign(new Error("Invalid provider rates."), { status: 400 });
  if (
    services.some(
      (service) =>
        typeof service.price !== 'number' || !Number.isFinite(service.price) || service.price < 0,
    )
  )
    throw Object.assign(new Error('Service price unavailable.'), { status: 400 });
  const money = (value) => Math.round(value * 100) / 100;
  const pricingItems = services.map((service) => {
    const originalCost = service.price,
      finalCost = money(originalCost * (1 - discountPercent / 100));
    const vitaCommissionAmount = money(finalCost * commissionPercent / 100);
    return {
      testId: service._id,
      originalCost,
      discountPercentage: discountPercent,
      discountAmount: money(originalCost - finalCost),
      finalCost,
      vitaCommissionAmount,
      providerNetAmount: money(finalCost - vitaCommissionAmount),
    };
  });
  const sum = (key) => money(pricingItems.reduce((total, item) => total + item[key], 0));
  return {
    pricingItems,
    originalCost: sum('originalCost'),
    discount: discountPercent,
    discountAmount: sum('discountAmount'),
    totalCost: sum('finalCost'),
    vitaCommissionPercent: commissionPercent,
    vitaCommissionAmount: sum('vitaCommissionAmount'),
    providerNetAmount: sum('providerNetAmount'),
  };
};
