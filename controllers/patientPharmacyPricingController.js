const PharmacyInventory = require('../models/PharmacyInventory');
const User = require('../models/User');
const Product = require('../models/Product');
const { patientSellingPrice } = require('../utils/patientSellingPrice');

/** Patient checkout reads selling prices, never pharmacy management data. */
exports.getPrices = async (req, res) => {
  if (req.user?.role !== 'User') return res.status(403).json({ message: 'Not authorized.' });
  const { pharmacyId } = req.params;
  if (!/^[a-f\d]{24}$/i.test(pharmacyId)) {
    return res.status(400).json({ message: 'Invalid pharmacy ID.' });
  }
  let modernSelection = {};
  let legacySelection = {};
  if (req.method === 'POST') {
    const selection = req.body?.items;
    if (!Array.isArray(selection) || !selection.length || selection.length > 100 || selection.some(item =>
      !item || typeof item.name !== 'string' || item.name.length > 200 ||
      (item.id != null && typeof item.id !== 'string') ||
      (!/^[a-f\d]{24}$/i.test(item.id || '') && !item.name.trim())
    )) return res.status(400).json({ message: 'Select between 1 and 100 medicines.' });
    const ids = [...new Set(selection.map(item => item.id).filter(id => /^[a-f\d]{24}$/i.test(id || '')))];
    const names = [...new Set(selection.map(item => item.name.trim()).filter(Boolean))]
      .map(name => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
    modernSelection = { $or: [{ drugId: { $in: ids } }, { drugName: { $in: names } }] };
    legacySelection = { $or: [{ drugId: { $in: ids } }, { _id: { $in: ids } }, { name: { $in: names } }] };
  }
  try {
    const [pharmacy, rows, legacyProducts] = await Promise.all([
      User.findOne({
        _id: pharmacyId,
        role: 'Pharmacy',
        activationStatus: 'active',
        isPublic: { $ne: false },
        patientOrderingEnabled: { $ne: false },
      }).select('_id').lean(),
      PharmacyInventory.find({
        pharmacyId,
        isActive: true,
        isAvailable: true,
        quantity: { $gt: 0 },
        ...modernSelection,
      }).select('drugId drugName price priceSource')
        .populate('drugId', 'unitSellingPrice').lean(),
      // Older pharmacy screens maintain Product stock instead of PharmacyInventory.
      Product.find({ pharmacyId, isActive: true, amount: { $gt: 0 }, ...legacySelection })
        .select('_id drugId name price').lean(),
    ]);
    if (!pharmacy) return res.status(404).json({ message: 'Pharmacy is unavailable for ordering.' });
    // Explicit serialization also protects this contract if the query changes.
    const items = rows.map(row => ({
      drugId: row.drugId?._id || row.drugId,
      drugName: row.drugName,
      price: patientSellingPrice(row, row.drugId?.unitSellingPrice),
    }));
    const knownDrugIds = new Set(items.map(item => String(item.drugId)));
    for (const product of legacyProducts) {
      const drugId = product.drugId || product._id;
      if (knownDrugIds.has(String(drugId))) continue;
      items.push({ drugId, drugName: product.name, price: product.price });
      knownDrugIds.add(String(drugId));
    }
    return res.json({ items });
  } catch (error) {
    console.error('Patient pharmacy pricing failed:', error);
    return res.status(500).json({ message: 'Unable to load pharmacy prices.' });
  }
};
