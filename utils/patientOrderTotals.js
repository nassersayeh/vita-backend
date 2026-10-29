exports.patientOrderTotals = (items, deliveryMethod) => {
  const subtotal = Math.round(items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0) * 100) / 100;
  const deliveryFee = deliveryMethod === 'delivery' ? 15 : 0;
  return { subtotal, deliveryFee, total: Math.round((subtotal + deliveryFee) * 100) / 100 };
};
