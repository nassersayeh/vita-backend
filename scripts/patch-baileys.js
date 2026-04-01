#!/usr/bin/env node
/**
 * Patch Baileys library to use MACOS platform instead of WEB
 * This fixes the 405/401 Connection Failure error when pairing
 * See: https://github.com/WhiskeySockets/Baileys/issues/2370
 * See: https://github.com/WhiskeySockets/Baileys/pull/2365
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@whiskeysockets',
  'baileys',
  'lib',
  'Utils',
  'validate-connection.js'
);

if (!fs.existsSync(filePath)) {
  console.log('⚠️ Baileys validate-connection.js not found, skipping patch');
  process.exit(0);
}

let content = fs.readFileSync(filePath, 'utf8');
const original = 'platform: proto.ClientPayload.UserAgent.Platform.WEB';
const patched = 'platform: proto.ClientPayload.UserAgent.Platform.MACOS';

if (content.includes(patched)) {
  console.log('✅ Baileys already patched (Platform.MACOS)');
  process.exit(0);
}

if (content.includes(original)) {
  content = content.replace(original, patched);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✅ Baileys patched: Platform.WEB → Platform.MACOS');
} else {
  console.log('⚠️ Could not find Platform.WEB in validate-connection.js');
}
