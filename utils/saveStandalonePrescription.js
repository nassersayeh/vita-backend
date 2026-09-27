const { randomUUID } = require('crypto');
const { activePrescriptionFilter, buildPrescriptionQuote } = require('./pharmacyPrescriptionPricing');

// Standalone MongoDB cannot commit multiple documents in a transaction. Serialize
// prescription writes with a durable lock and compensate known failed writes.
// Keep the lock on ambiguous failures so a retry cannot dispense a second time.
async function saveStandalonePrescription({ Prescription, Inventory, Quote, prescriptionId, pharmacyId, items, dispense, beforeCommit, validatePrescription, commitFields = {}, auditEvent }) {
  const token = randomUUID();
  const lockFilter = { _id: prescriptionId, 'pharmacyWriteLock.token': token };
  const prescription = await Prescription.findOneAndUpdate(
    { _id: prescriptionId, ...activePrescriptionFilter(), pharmacyWriteLock: null },
    { $set: { pharmacyWriteLock: { token, startedAt: new Date(), pharmacyId, dispense } } },
    { new: true },
  );
  if (!prescription) throw new Error('UNAVAILABLE');
  const stockChanges = [];
  let oldQuote;
  let quoteWritten = false;
  let writePending = false;
  let finalizing = false;
  const quoteFilter = { prescription: prescriptionId, pharmacy: pharmacyId };
  try {
    if (validatePrescription) await validatePrescription(prescription);
    const pricing = buildPrescriptionQuote(prescription.products, items);
    oldQuote = await Quote.findOne(quoteFilter).lean();
    if (dispense) {
      // Aggregate duplicate drug lines before touching inventory.
      const quantities = new Map();
      for (const product of prescription.products) {
        if (!product.drugId) throw new Error('STOCK');
        const key = String(product.drugId);
        quantities.set(key, (quantities.get(key) || 0) + (product.quantity ?? 1));
      }
      for (const [drugId, quantity] of quantities) {
        writePending = true;
        const stock = await Inventory.findOneAndUpdate(
          { pharmacyId, drugId, isActive: true, isAvailable: true, quantity: { $gte: quantity } },
          { $inc: { quantity: -quantity, soldCount: quantity } },
          { new: true },
        );
        writePending = false;
        if (!stock) throw new Error('STOCK');
        stockChanges.push({ inventoryId: stock._id, quantity });
      }
    }
    writePending = true;
    const quote = await Quote.findOneAndUpdate(quoteFilter,
      { ...pricing, status: dispense ? 'dispensed' : 'priced' },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    writePending = false;
    quoteWritten = true;
    if (beforeCommit) await beforeCommit();
    // This is the commit point. A failed response may still mean the write was
    // applied; keep the operation locked if the result is ambiguous.
    finalizing = true;
    const result = await Prescription.updateOne({ ...lockFilter, ...activePrescriptionFilter() }, {
      $unset: { pharmacyWriteLock: 1 },
      ...(auditEvent ? { $push: { audit: auditEvent } } : {}),
      ...(dispense ? { $set: { ...commitFields, dispensedAt: new Date(), dispensedBy: pharmacyId, workflowStatus: 'completed' }, $inc: { dispensedCount: 1 } } : {}),
    });
    finalizing = false;
    if (!result.modifiedCount) throw new Error('UNAVAILABLE');
    return quote;
  } catch (error) {
    if (writePending || finalizing) {
      // Do not guess whether a database/network failure applied a write.
      // Preserve the lock for reconciliation instead of restoring unverified stock.
      const recovery = new Error('RECOVERY_REQUIRED');
      recovery.cause = error;
      throw recovery;
    }
    try {
      if (quoteWritten) {
        if (oldQuote) {
          const { items, originalTotal, discountedTotal, vitaCommissionTotal, status } = oldQuote;
          await Quote.updateOne(quoteFilter, { $set: { items, originalTotal, discountedTotal, vitaCommissionTotal, status } });
        } else {
          await Quote.deleteOne(quoteFilter);
        }
      }
      for (const { inventoryId, quantity } of stockChanges.reverse()) {
        const restored = await Inventory.updateOne({ _id: inventoryId }, { $inc: { quantity, soldCount: -quantity } });
        if (!restored.modifiedCount) throw new Error('RESTORE_FAILED');
      }
      await Prescription.updateOne(lockFilter, { $unset: { pharmacyWriteLock: 1 } });
    } catch (recoveryError) {
      const recovery = new Error('RECOVERY_REQUIRED');
      recovery.cause = recoveryError;
      throw recovery;
    }
    throw error;
  }
}
module.exports = { saveStandalonePrescription };
