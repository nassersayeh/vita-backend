// Additive indexes only. The maintenance script never removes existing indexes.
module.exports = {
  users: [
    { key: { createdAt: -1, _id: -1 }, name: 'admin_users_created' },
    { key: { role: 1, createdAt: -1, _id: -1 }, name: 'admin_users_role_created' },
    { key: { activationStatus: 1, role: 1, createdAt: -1 }, name: 'admin_users_status_role_created' }
  ],
  orders: [{ key: { createdAt: -1 }, name: 'admin_orders_created' }],
  appointments: [{ key: { appointmentDateTime: -1 }, name: 'admin_appointments_date' }],
  demorequests: [{ key: { status: 1, createdAt: -1 }, name: 'admin_demo_status_created' }]
};
