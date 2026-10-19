// One aggregation keeps totals and per-role counts in the same database result.
const userDistributionPipeline = (startDate, endDate) => [
  { $group: {
    _id: { $ifNull: ['$role', 'Unknown'] },
    count: { $sum: 1 },
    active: { $sum: { $cond: [{ $eq: ['$activationStatus', 'active'] }, 1, 0] } },
    pending: { $sum: { $cond: [{ $eq: ['$activationStatus', 'pending'] }, 1, 0] } },
    recent: { $sum: { $cond: [{ $and: [
      { $gte: ['$createdAt', startDate] }, { $lte: ['$createdAt', endDate] }
    ] }, 1, 0] } }
  } }
];

const summarizeUserDistribution = (groups, roles) => {
  const byRole = Object.fromEntries(roles.map(role => [role, 0]));
  const recentRegistrations = { ...byRole };
  let total = 0, active = 0, pending = 0;
  for (const group of groups) {
    byRole[group._id] = group.count;
    recentRegistrations[group._id] = group.recent;
    total += group.count;
    active += group.active;
    pending += group.pending;
  }
  return { total, active, pending, byRole, recentRegistrations };
};

module.exports = { userDistributionPipeline, summarizeUserDistribution };
