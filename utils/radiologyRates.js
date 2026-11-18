const radiologyRates = (provider, defaultDiscount = 20) => ({
  discountPercent: provider?.radiologyDiscountPercent ?? defaultDiscount,
  commissionPercent: provider?.radiologyCommissionPercent ?? 5,
});
module.exports = { radiologyRates };
