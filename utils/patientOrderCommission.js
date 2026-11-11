// Realized pharmacy patient orders only; POS sales and cancelled requests are excluded.
const realizedPatientOrders = {
  user: { $ne: null }, pharmacyPricedAt: { $type: 'date' },
  status: { $in: ['delivered', 'completed'] }, adminApprovalStatus: { $ne: 'rejected' },
};
const orderCommissionRevenuePipeline = (from, to) => [
  { $match: realizedPatientOrders },
  { $addFields: { commissionRealizedAt: { $ifNull: ['$deliveredAt', '$updatedAt'] } } },
  { $match: { commissionRealizedAt: { $gte: from, $lt: to } } },
  { $group: { _id: null, totalRevenue: { $sum: '$vitaCommissionAmount' }, grossOrderValue: { $sum: '$total' } } },
];
module.exports = { realizedPatientOrders, orderCommissionRevenuePipeline };
