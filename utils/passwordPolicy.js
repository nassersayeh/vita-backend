const getUtf8ByteLength = (value) => Buffer.byteLength(String(value || ''), 'utf8');

const normalizeComparable = (value) => String(value || '')
  .normalize('NFKC')
  .toLocaleLowerCase('en-US')
  .replace(/[\s._-]+/g, '');

const passwordContainsAccountName = (password, fullName) => {
  const normalizedPassword = normalizeComparable(password);
  const normalizedFullName = normalizeComparable(fullName);
  const nameParts = String(fullName || '')
    .normalize('NFKC')
    .split(/[\s._-]+/)
    .map(normalizeComparable)
    .filter((part) => part.length >= 3);

  return Boolean(
    normalizedFullName.length >= 3 && normalizedPassword.includes(normalizedFullName)
  ) || nameParts.some((part) => normalizedPassword.includes(part));
};

const validatePasswordPolicy = (password, fullName) => {
  if (typeof password !== 'string' || password.length < 8) return 'PASSWORD_TOO_SHORT';
  if (getUtf8ByteLength(password) > 72) return 'PASSWORD_TOO_LONG';
  if (passwordContainsAccountName(password, fullName)) return 'PASSWORD_CONTAINS_NAME';
  return null;
};

module.exports = { validatePasswordPolicy, passwordContainsAccountName };
