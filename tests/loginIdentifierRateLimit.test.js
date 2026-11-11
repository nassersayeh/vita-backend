const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loginLimiters } = require('../middleware/authRateLimiter');
test('Arabic digits and pasted direction marks cannot bypass the login account attempt limit', () => {
  const limit = loginLimiters[1];
  let allowed = 0, denied = 0;
  for (let i = 0; i < 13; i++) {
    const mobile = ['0597723456', '٠٥٩٧٧٢٣٤٥٦', '\u200e0597723456\u200f'][i % 3];
    limit({ body: { mobile } }, { set() { return this; }, status(code) { assert.equal(code, 429); denied++; return this; }, json() {} }, () => { allowed++; });
  }
  assert.equal(allowed, 12); assert.equal(denied, 1);
});
