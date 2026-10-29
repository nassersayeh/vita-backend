exports.serviceFilter = (providerId, type) => ({
  type,
  isActive: true,
  $or: [{ providerId }, { providerId: null, createdBy: providerId }],
});
exports.serviceTotals = (services) => {
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
      finalCost = money(originalCost * 0.8);
    const vitaCommissionAmount = money(finalCost * 0.05);
    return {
      testId: service._id,
      originalCost,
      discountPercentage: 20,
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
    discount: 20,
    discountAmount: sum('discountAmount'),
    totalCost: sum('finalCost'),
    vitaCommissionPercent: 5,
    vitaCommissionAmount: sum('vitaCommissionAmount'),
    providerNetAmount: sum('providerNetAmount'),
  };
};
