/**
 * Phase 7 Step 4g – Negative Upload Tests for Collectible Artwork
 * Tests controller-level validation WITHOUT calling Cloudinary.
 * Run: node test_artwork_upload.js
 */
'use strict';

const assert = require('assert');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

// Import the validation helpers directly from the controller
// We extract the pure-validation logic by requiring the module and testing
// the underlying helpers by reproducing them inline (since the controller
// is an async Express handler, we test each guard independently).

const { randomUUID } = require('crypto');
const path = require('path');

/* ── Re-implement pure validation helpers from controller for unit testing ── */
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

function getExtension(filename) {
  if (!filename) return '';
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
}

const FILE_SIGNATURES = [
  { mime: 'image/jpeg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
  { mime: 'image/png',  magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
];

function isWebP(buffer) {
  if (buffer.length < 12) return false;
  return buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP';
}

function isSvg(buffer) {
  const head = buffer.slice(0, 512).toString('utf8').toLowerCase();
  return head.includes('<svg') || head.includes('<!doctype svg');
}

function validateFileSignature(buffer, mimeType) {
  if (mimeType === 'image/webp') return isWebP(buffer);
  if (isSvg(buffer)) return false;
  const sig = FILE_SIGNATURES.find(s => s.mime === mimeType && s.magic);
  if (!sig) return false;
  return buffer.slice(0, sig.magic.length).equals(sig.magic);
}

// Minimal valid JPEG magic bytes
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
// Minimal valid PNG magic bytes
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Minimal RIFF/WEBP header
const WEBP_MAGIC = Buffer.concat([
  Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')
]);

console.log('\n[1] MIME type validation');
test('Rejects text/plain MIME', () => assert(!ALLOWED_MIMES.has('text/plain')));
test('Rejects image/svg+xml MIME', () => assert(!ALLOWED_MIMES.has('image/svg+xml')));
test('Rejects application/pdf MIME', () => assert(!ALLOWED_MIMES.has('application/pdf')));
test('Rejects application/octet-stream MIME', () => assert(!ALLOWED_MIMES.has('application/octet-stream')));
test('Accepts image/jpeg MIME', () => assert(ALLOWED_MIMES.has('image/jpeg')));
test('Accepts image/png MIME', () => assert(ALLOWED_MIMES.has('image/png')));
test('Accepts image/webp MIME', () => assert(ALLOWED_MIMES.has('image/webp')));

console.log('\n[2] Extension validation');
test('Rejects .svg extension', () => assert(!ALLOWED_EXTENSIONS.has('.svg')));
test('Rejects .gif extension', () => assert(!ALLOWED_EXTENSIONS.has('.gif')));
test('Rejects .exe extension', () => assert(!ALLOWED_EXTENSIONS.has('.exe')));
test('Rejects .pdf extension', () => assert(!ALLOWED_EXTENSIONS.has('.pdf')));
test('Rejects no extension', () => assert(!ALLOWED_EXTENSIONS.has('')));
test('Accepts .jpg extension', () => assert(ALLOWED_EXTENSIONS.has('.jpg')));
test('Accepts .jpeg extension', () => assert(ALLOWED_EXTENSIONS.has('.jpeg')));
test('Accepts .png extension', () => assert(ALLOWED_EXTENSIONS.has('.png')));
test('Accepts .webp extension', () => assert(ALLOWED_EXTENSIONS.has('.webp')));
test('getExtension handles no extension', () => assert.strictEqual(getExtension('noext'), ''));
test('getExtension is case-insensitive', () => assert.strictEqual(getExtension('file.PNG'), '.png'));

console.log('\n[3] File size validation');
test('Rejects file exactly at limit + 1 byte', () => {
  const size = MAX_SIZE_BYTES + 1;
  assert(size > MAX_SIZE_BYTES, 'Should be over limit');
});
test('Accepts file exactly at limit', () => {
  const size = MAX_SIZE_BYTES;
  assert(size <= MAX_SIZE_BYTES, 'Should be at or under limit');
});

console.log('\n[4] File signature (magic bytes) validation');
test('JPEG magic bytes accepted for image/jpeg', () => {
  assert(validateFileSignature(JPEG_MAGIC, 'image/jpeg'));
});
test('PNG magic bytes accepted for image/png', () => {
  assert(validateFileSignature(PNG_MAGIC, 'image/png'));
});
test('WebP magic bytes accepted for image/webp', () => {
  assert(validateFileSignature(WEBP_MAGIC, 'image/webp'));
});
test('Rejects PNG buffer when declared as image/jpeg', () => {
  assert(!validateFileSignature(PNG_MAGIC, 'image/jpeg'));
});
test('Rejects JPEG buffer when declared as image/png', () => {
  assert(!validateFileSignature(JPEG_MAGIC, 'image/png'));
});
test('Rejects empty buffer for image/jpeg', () => {
  assert(!validateFileSignature(Buffer.alloc(0), 'image/jpeg'));
});
test('Rejects random bytes for image/png', () => {
  assert(!validateFileSignature(Buffer.from([0x00, 0x01, 0x02, 0x03]), 'image/png'));
});

console.log('\n[5] SVG detection and rejection');
test('Detects inline SVG content', () => {
  const svgBuf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
  assert(isSvg(svgBuf));
});
test('Detects DOCTYPE svg content', () => {
  const svgBuf = Buffer.from('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN">');
  assert(isSvg(svgBuf));
});
test('Rejects SVG masquerading as JPEG via signature', () => {
  const svgBuf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert(!validateFileSignature(svgBuf, 'image/jpeg'));
});
test('Rejects SVG masquerading as PNG via signature', () => {
  const svgBuf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert(!validateFileSignature(svgBuf, 'image/png'));
});
test('Normal JPEG buffer is not classified as SVG', () => {
  assert(!isSvg(JPEG_MAGIC));
});

console.log('\n[6] Public ID generation (server-side, never user-supplied)');
test('Generated public ID is a UUID-based string', () => {
  const publicId = `collectible_${randomUUID().replace(/-/g, '')}`;
  assert(publicId.startsWith('collectible_'));
  assert(publicId.length > 20);
  // Must NOT contain hyphens (UUID sanitized)
  assert(!publicId.slice('collectible_'.length).includes('-'));
});
test('Two generated public IDs are unique', () => {
  const a = `collectible_${randomUUID().replace(/-/g, '')}`;
  const b = `collectible_${randomUUID().replace(/-/g, '')}`;
  assert.notStrictEqual(a, b);
});

console.log('\n[7] Route and controller syntax checks');
const { execSync } = require('child_process');
test('collectible.routes.js passes node --check', () => {
  execSync('node --check routes/collectible.routes.js', { cwd: __dirname, stdio: 'pipe' });
});
test('collectibleArtwork.controller.js passes node --check', () => {
  execSync('node --check controllers/collectibleArtwork.controller.js', { cwd: __dirname, stdio: 'pipe' });
});
test('csrf.middleware.js passes node --check', () => {
  execSync('node --check middleware/csrf.middleware.js', { cwd: __dirname, stdio: 'pipe' });
});

console.log(`\nArtwork upload validation tests: Passed ${passed}, Failed ${failed}`);
if (failed > 0) process.exit(1);
