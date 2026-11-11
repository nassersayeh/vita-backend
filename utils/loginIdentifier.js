// Normalize identifiers only; never normalize, trim or rewrite passwords.
function normalizeLoginIdentifier(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/[\u0660-\u0669\u06f0-\u06f9\uff10-\uff19]/g, digit => {
    const code = digit.charCodeAt(0);
    return String(code - (code >= 0xff10 ? 0xff10 : code >= 0x06f0 ? 0x06f0 : 0x0660));
  }).replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim();
}
module.exports = { normalizeLoginIdentifier };
