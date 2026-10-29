const Drug = require('../models/Drug');
const idOf = value => String(value?._id || value || '');
const nameOf = value => String(value || '').normalize('NFKC').trim().toLowerCase();
const failure = message => Object.assign(new Error(message), { status: 400 });

/** Both checkout preview and order persistence use the central selling price. */
exports.catalogCheckoutPricing = async selection => {
  if (!Array.isArray(selection) || !selection.length || selection.length > 100 || selection.some(item =>
    !item || typeof item.name !== 'string' || item.name.length > 200 ||
    (item.id != null && typeof item.id !== 'string') || (!item.id && !item.name.trim())
  )) throw failure('Select between 1 and 100 medicines.');
  const ids = selection.map(item => item.id).filter(id => /^[a-f\d]{24}$/i.test(id || ''));
  const names = selection.map(item => item.name.trim()).filter(Boolean)
    .map(name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
  const drugs = await Drug.find({ isActive: true, $or: [{ _id: { $in: ids } }, { name: { $in: names } }] })
    .select('_id name unitSellingPrice').lean();
  return selection.map(item => {
    const byId = drugs.find(drug => idOf(drug._id) === item.id);
    const byName = drugs.filter(drug => nameOf(drug.name) === nameOf(item.name));
    const drug = byId || (byName.length === 1 ? byName[0] : null);
    const raw = drug?.unitSellingPrice;
    const price = raw != null && raw !== '' && typeof raw !== 'boolean' && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null;
    return { drugId: drug?._id || item.id || null, drugName: drug?.name || item.name, price };
  });
};
