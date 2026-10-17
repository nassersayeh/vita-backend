const money = value => Math.round(Number(value || 0) * 100) / 100;
const sum = (rows, key) => money(rows.reduce((total, row) => total + Number(row[key] || 0), 0));
module.exports = function buildReport(ledgers, appointments, records) {
  const transactions = ledgers.flatMap(row => row.transactions || []);
  const expenses = ledgers.flatMap(row => row.expenses || []);
  const debts = ledgers.flatMap(row => row.debts || []);
  const pending = debts.filter(row => row.status === 'pending');
  const vitaAppointments = appointments.filter(row => row.bookingSource === 'vita');
  const eligible = vitaAppointments.filter(row => row.status === 'completed' && row.isPaid && !row.autoMarkedAsPaid);
  const appointmentCommission = money(eligible.reduce((total, row) => total + money(Number(row.paymentAmount || 0) * 0.05), 0));
  const recordedCommission = sum(records, 'vitaCommissionAmount');
  const income = sum(transactions, 'amount');
  const expenseTotal = sum(expenses, 'amount');
  return {
    generatedAt: new Date(),
    summary: {
      income, expenses: expenseTotal, cashNet: money(income - expenseTotal),
      debtCreated: money(debts.reduce((total, row) => total + Number(row.originalAmount ?? row.amount ?? 0), 0)),
      patientDebt: sum(pending.filter(row => row.debtorType !== 'insurance'), 'amount'),
      insuranceDebt: sum(pending.filter(row => row.debtorType === 'insurance'), 'amount'),
      paymentCount: transactions.length, expenseCount: expenses.length,
      indebtedPatients: new Set(pending.filter(row => row.patientId && row.debtorType !== 'insurance').map(row => String(row.patientId._id || row.patientId))).size,
      appointmentCount: appointments.length, vitaAppointmentCount: vitaAppointments.length,
      unknownSourceCount: appointments.filter(row => !row.bookingSource || row.bookingSource === 'unknown').length,
      completedAppointments: appointments.filter(row => row.status === 'completed').length,
      cancelledAppointments: appointments.filter(row => row.status === 'cancelled').length,
      upcomingAppointments: appointments.filter(row => ['confirmed', 'pending'].includes(row.status) && new Date(row.appointmentDateTime) >= new Date()).length,
      eligibleAppointmentCount: eligible.length, appointmentPayments: sum(eligible, 'paymentAmount'),
      appointmentCommissionRate: 5, appointmentCommission, recordedTreatmentCommission: recordedCommission,
    },
    expensesByReason: Object.entries(expenses.reduce((groups, row) => {
      const reason = row.description || row.category || 'اخرى'; groups[reason] = (groups[reason] || 0) + Number(row.amount || 0); return groups;
    }, {})).map(([reason, amount]) => ({ reason, amount: money(amount) })),
    history: [...transactions.map(row => ({ ...row, type: 'payment' })), ...expenses.map(row => ({ ...row, type: 'expense' })), ...debts.map(row => ({ ...row, type: 'debt' }))].sort((a,b) => new Date(b.date) - new Date(a.date)),
  };
};
