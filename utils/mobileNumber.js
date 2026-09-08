const DIALING_CODES = ['970', '972', '974', '966', '962'];

const normalizeMobileForStorage = (mobile = '') => {
  let digits = String(mobile || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  const code = DIALING_CODES.find((candidate) => digits.startsWith(candidate));
  if (!code) return digits;

  digits = digits.slice(code.length).replace(/^0+/, '');
  if (['970', '972', '966'].includes(code) && digits.startsWith('5')) return `0${digits}`;
  if (code === '962' && digits.startsWith('7')) return `0${digits}`;
  return digits;
};

const getMobileCandidates = (mobile = '') => {
  const raw = String(mobile || '').replace(/\D/g, '').replace(/^00/, '');
  const local = normalizeMobileForStorage(mobile);
  const withoutZero = local.replace(/^0+/, '');
  return Array.from(new Set([
    String(mobile || '').trim(), raw, local, withoutZero, `0${withoutZero}`,
    ...DIALING_CODES.map((code) => `${code}${withoutZero}`),
  ].filter(Boolean)));
};

module.exports = { getMobileCandidates, normalizeMobileForStorage };
