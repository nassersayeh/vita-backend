const { isPalestinian } = require('./controlledPolicy');
const MESSAGE = 'هذا الدواء معتمد ككونترول. استخدم مسار الروشيتا الكونترولد وصلاحياته.';
async function assertOrdinaryAllowed(products, provider, models) {
  if (!products?.length) return;
  const User = models?.User || require('../models/User');
  const Catalogue = models?.Catalogue || require('../models/ControlledDrug');
  const user = provider && typeof provider === 'object' && provider.country ? provider : await User.findById(provider?._id || provider).select('country');
  if (!isPalestinian(user)) return;
  const catalogue = await Catalogue.find({ approved: true }).populate('drugId', 'name').lean();
  const ids = new Set(catalogue.map(row => String(row.drugId?._id || row.drugId)));
  const names = new Set(catalogue.map(row => normalize(row.drugId?.name)).filter(Boolean));
  if (products.some(p => ids.has(String(p.drugId?._id || p.drugId || p.productId?._id || p.productId)) || names.has(normalize(p.name)))) {
    const error = new Error(MESSAGE); error.status = 403; error.code = 'CONTROLLED_REQUIRED'; throw error;
  }
}
function normalize(value) { return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' '); }
module.exports = { assertOrdinaryAllowed, MESSAGE };
