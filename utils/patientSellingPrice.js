const valid = value => value != null && value !== '' && typeof value !== 'boolean' &&
  Number.isFinite(Number(value)) && Number(value) >= 0;

/** Old auto-assigned stock used zero for missing prices. Only a deliberate
 * pharmacy price may make an item free; catalog prices repair legacy placeholders.
 */
exports.patientSellingPrice = (row, catalogPrice) => {
  if (valid(row.price) && (Number(row.price) > 0 || row.priceSource === 'manual')) return Number(row.price);
  if (valid(catalogPrice) && Number(catalogPrice) > 0) return Number(catalogPrice);
  return null;
};
