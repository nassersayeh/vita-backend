const { createHmac, timingSafeEqual } = require('crypto');
// Clinical seal: independent domain/key, no patient data or signatures in logs.
// This detects database-only clinical tampering; it is not a legal digital signature.
const id = value => String(value?._id || value || '');
const date = value => value ? new Date(value).toISOString() : null;
function canonical(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value.toHexString) return value.toHexString();
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  return value;
}
function payload(rx) {
  if (typeof rx.toObject === 'function') rx = rx.toObject();
  return JSON.stringify(canonical({ version: 1, serial: rx.serial, allocationId: id(rx.allocationId), doctorId: id(rx.doctorId), patientId: id(rx.patientId),
    issuedAt: date(rx.issuedAt), issueRequestId: rx.issueRequestId, validityType: rx.validityType, expiryDate: date(rx.expiryDate), diagnosis: rx.diagnosis || '', notes: rx.notes || '',
    patientSnapshot: rx.patientSnapshot, doctorSnapshot: rx.doctorSnapshot,
    products: rx.products.map(p => ({ id: id(p._id), drugId: id(p.drugId), name: p.name, quantity: p.quantity, allowedPills: p.allowedPills, dose: p.dose, frequency: p.frequency, instructions: p.instructions || '' })) }));
}
function signPrescription(rx) {
  const secret = process.env.CONTROLLED_SIGNING_KEY;
  if (!secret || secret.length < 32) throw new Error('SIGNING_NOT_CONFIGURED');
  const key = createHmac('sha256', secret).update('vita:controlled:clinical-seal:v1').digest();
  return createHmac('sha256', key).update(payload(rx)).digest('hex');
}
function verifyPrescription(rx) {
  try {
    if (rx.integrityVersion !== 1 || !/^[a-f\d]{64}$/.test(rx.integritySeal || '')) return false;
    return timingSafeEqual(Buffer.from(rx.integritySeal, 'hex'), Buffer.from(signPrescription(rx), 'hex'));
  } catch { return false; }
}
function requireIntegrity(rx) { if (!verifyPrescription(rx)) throw new Error('INTEGRITY'); }
module.exports = { signPrescription, verifyPrescription, requireIntegrity };
