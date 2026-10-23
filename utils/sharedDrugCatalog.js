const { randomUUID } = require('node:crypto');
const normalize = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const failure = (message, status = 409) => Object.assign(new Error(message), { status });
const textFields = ['name', 'genericName', 'strength', 'dosageForm', 'manufacturer', 'description', 'category', 'barcode'];
function catalogInput(body) {
  const data = {};
  for (const key of textFields) {
    if (body[key] == null) continue;
    if (typeof body[key] !== 'string' || body[key].length > (key === 'description' ? 2000 : 200)) throw failure(`Invalid ${key}`, 400);
    const value = body[key].normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (value) data[key] = value;
  }
  if (!data.name) throw failure('Trade name is required', 400);
  const rawPrice = body.unitSellingPrice ?? body.price;
  if (rawPrice !== undefined && rawPrice !== null && rawPrice !== '') {
    if (typeof rawPrice === 'boolean' || !Number.isFinite(Number(rawPrice)) || Number(rawPrice) < 0) throw failure('Invalid selling price', 400);
    data.unitSellingPrice = Number(rawPrice);
  }
  return data;
}
function createCatalogService(Drug, Lock) {
  async function locked(keys, action) {
    const token = randomUUID(), acquired = [];
    try {
      for (const key of [...new Set(keys)].sort()) {
        let ok = false;
        for (let i = 0; i < 40; i += 1) {
          try {
            await Lock.findOneAndUpdate({ _id: key, expiresAt: { $lt: new Date() } }, { $set: { token, expiresAt: new Date(Date.now() + 120000) } }, { upsert: true, new: true });
            acquired.push(key); ok = true; break;
          } catch (e) { if (e.code !== 11000) throw e; }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!ok) throw failure('This medicine is being updated. Please retry.', 409);
      }
      return await action();
    } finally { if (acquired.length) await Lock.deleteMany({ _id: { $in: acquired }, token }); }
  }
  return async function resolveDrug(body) {
    const data = catalogInput(body);
    return locked([`name:${normalize(data.name)}`, ...(data.barcode ? [`barcode:${data.barcode}`] : [])], async () => {
      if (data.barcode) {
        const matches = await Drug.find({ barcode: data.barcode, isActive: true }).limit(3);
        if (matches.length > 1) throw failure('Multiple catalog records use this barcode. Contact support.');
        if (matches.length) {
          if (body.drugId && String(matches[0]._id) !== String(body.drugId)) throw failure('Barcode belongs to another medicine.');
          return { drug: matches[0], created: false, linked: false };
        }
      }
      const namePattern = new RegExp(`^\\s*${data.name.split(/\s+/).map(escape).join('\\s+')}\\s*$`, 'i');
      const candidates = await Drug.find({ name: namePattern, isActive: true });
      const compatible = candidates.filter(drug => ['genericName', 'strength', 'dosageForm'].every(key => !data[key] || !drug[key] || normalize(data[key]) === normalize(drug[key])));
      let drug;
      if (body.drugId) {
        if (!/^[a-f\d]{24}$/i.test(String(body.drugId))) throw failure('Invalid medicine ID', 400);
        drug = compatible.find(item => String(item._id) === String(body.drugId));
        if (!drug) throw failure('Selected medicine does not match the entered details.');
      } else {
        if (compatible.length > 1) throw failure('More than one medicine matches this name. Select the existing medicine or specify its strength and dosage form.');
        drug = compatible[0];
      }
      if (!drug) {
        if (!data.genericName) throw failure('Scientific name is required for a new medicine', 400);
        return { drug: await Drug.create({ ...data, isCustom: false, isActive: true }), created: true, linked: false };
      }
      if (data.barcode && drug.barcode && drug.barcode !== data.barcode) throw failure('This medicine already has a different barcode. Verify the pack and medicine details.');
      const patch = {};
      for (const [key, value] of Object.entries(data)) {
        if (key !== 'name' && (drug[key] === undefined || drug[key] === null || drug[key] === '')) patch[key] = value;
      }
      // Contribute formerly private manual entries to the shared catalog without changing their identity.
      if (drug.isCustom) { patch.isCustom = false; }
      const linked = Boolean(data.barcode && !drug.barcode);
      if (Object.keys(patch).length) {
        const updated = await Drug.findOneAndUpdate({ _id: drug._id, barcode: drug.barcode || { $in: [null, ''] } }, { $set: patch, $unset: { ownerPharmacyId: '' } }, { new: true, runValidators: true });
        if (!updated) throw failure('Medicine changed while saving. Please retry.');
        drug = updated;
      }
      return { drug, created: false, linked };
    });
  };
}
module.exports = { createCatalogService, catalogInput, normalize };
