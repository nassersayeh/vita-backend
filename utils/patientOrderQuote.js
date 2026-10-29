const money = value => Math.round(value * 100) / 100;
const fail = () => { throw Object.assign(new Error('Provide one valid discounted unit price per medicine, between zero and its original price.'), { status: 400 }); };
exports.buildPatientOrderQuote = (items, prices, deliveryFee) => {
  if (!Array.isArray(prices) || prices.length !== items.length || !items.length) fail();
  const byIndex = new Map();
  for (const line of prices) {
    if (!line || !Number.isInteger(line.index) || line.index < 0 || line.index >= items.length || byIndex.has(line.index) ||
      line.discountedPrice == null || typeof line.discountedPrice === 'boolean' || String(line.discountedPrice).trim() === '' ||
      !Number.isFinite(Number(line.discountedPrice))) fail();
    byIndex.set(line.index, Number(line.discountedPrice));
  }
  const quoted = items.map((item, index) => {
    const originalPrice = Number(item.originalPrice ?? item.price), price = money(byIndex.get(index));
    if (!Number.isFinite(originalPrice) || originalPrice < 0 || price < 0 || price > originalPrice || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1) fail();
    return { ...(item.toObject ? item.toObject() : item), originalPrice, price };
  });
  const originalSubtotal = money(quoted.reduce((sum, item) => sum + item.originalPrice * item.quantity, 0));
  const subtotal = money(quoted.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const discountAmount = money(originalSubtotal - subtotal);
  return { items: quoted, originalSubtotal, subtotal, originalTotal: money(originalSubtotal + deliveryFee), total: money(subtotal + deliveryFee), discountAmount,
    discountPercentage: originalSubtotal ? money(discountAmount / originalSubtotal * 100) : 0 };
};
