const COMMISSION_PERCENT = 5;
const cents = value => Math.round((Number(value) || 0) * 100);
const money = value => value / 100;

function priceItem(item) {
  const original = cents(item.originalCost ?? item.price);
  const discountPercentage = Number(item.discountPercentage) || 0;
  const discount = Math.round(original * discountPercentage / 100);
  const final = original - discount;
  const commission = Math.round(final * COMMISSION_PERCENT / 100);
  return { name: item.name, price: money(final), originalCost: money(original), discountPercentage,
    discountAmount: money(discount), vitaCommissionPercent: COMMISSION_PERCENT,
    vitaCommissionAmount: money(commission), providerNetAmount: money(final - commission) };
}

function requestAccounting(request) {
  const items = (request.pricing || []).map(item => {
    if (item.vitaCommissionAmount != null && item.providerNetAmount != null) return item;
    return priceItem(item);
  });
  const complete = items.length === request.tests.length && request.tests.every(name => items.some(i => i.name === name));
  const sum = key => money(items.reduce((total, item) => total + cents(item[key]), 0));
  return { items, isPriced: complete, totalCost: sum('price'), originalCost: sum('originalCost'),
    discountAmount: sum('discountAmount'), vitaCommissionAmount: sum('vitaCommissionAmount'), providerNetAmount: sum('providerNetAmount') };
}

function monthlyAccounts(requests) {
  const rows = requests.map(request => ({ requestId: request._id, patientName: request.patientId?.fullName,
    patientIdNumber: request.patientId?.idNumber, doctorName: request.doctorId?.fullName,
    completedAt: request.completedAt || request.updatedAt, tests: request.tests, ...requestAccounting(request) }));
  const priced = rows.filter(row => row.isPriced);
  const sum = key => money(priced.reduce((total, row) => total + cents(row[key]), 0));
  return { rows, summary: { completedReferrals: rows.length, testCount: rows.reduce((n,r) => n + r.tests.length, 0),
    unpricedReferrals: rows.length - priced.length, grossIncome: sum('totalCost'), discountAmount: sum('discountAmount'),
    vitaCommission: sum('vitaCommissionAmount'), laboratoryNetIncome: sum('providerNetAmount') } };
}
module.exports = { COMMISSION_PERCENT, priceItem, requestAccounting, monthlyAccounts };
