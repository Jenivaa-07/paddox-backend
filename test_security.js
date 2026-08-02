/**
 * Phase 7 Security Tests – MongoDB NoSQL Injection + AI Studio Removal
 *
 * Run: node test_security.js
 * Requires: paddox-backend Node server is NOT running (tests the middleware in isolation)
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

// ─────────────────────────────────────────────────────────────────────────────
// 1. express-mongo-sanitize is present and loadable
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] express-mongo-sanitize package check');

let mongoSanitize;
test('express-mongo-sanitize is installed and requires without error', () => {
  mongoSanitize = require('express-mongo-sanitize');
  assert(typeof mongoSanitize === 'function', 'should be a middleware factory');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Sanitization middleware unit tests (simulate req/res/next)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] Sanitization behaviour');

function makeMockReq(body = {}, query = {}, params = {}) {
  return { body, query, params, headers: {} };
}

function makeMockRes() {
  let status = 200;
  let json = null;
  return {
    _status: () => status,
    _json: () => json,
    status(s) { status = s; return this; },
    json(j) { json = j; return this; },
  };
}

const middleware = mongoSanitize
  ? mongoSanitize({ replaceWith: '_', allowDots: false, onSanitize: () => {} })
  : null;

function runMiddleware(req) {
  if (!middleware) throw new Error('middleware not loaded');
  const res = makeMockRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  return { req, nextCalled };
}

test('$ne operator in body is sanitized', () => {
  const req = makeMockReq({ email: { $ne: null }, password: 'test' });
  const { req: cleaned, nextCalled } = runMiddleware(req);
  assert(nextCalled, 'next must be called after sanitization');
  assert(!JSON.stringify(cleaned.body).includes('$ne'), 'body must not contain $ne after sanitization');
});

test('$gt operator in body is sanitized', () => {
  const req = makeMockReq({ price: { $gt: 0 } });
  const { req: cleaned } = runMiddleware(req);
  assert(!JSON.stringify(cleaned.body).includes('$gt'));
});

test('nested $ne is sanitized', () => {
  const req = makeMockReq({ user: { role: { $ne: 'user' } } });
  const { req: cleaned } = runMiddleware(req);
  assert(!JSON.stringify(cleaned.body).includes('$ne'));
});

test('$where operator in parsed query object is sanitized', () => {
  // express-mongo-sanitize operates on parsed body and params.
  // Query strings are plain strings; if the application parses them
  // into objects (e.g. via qs), the sanitizer also covers req.query objects.
  // Test: parsed query object containing $where is sanitized.
  const req = makeMockReq({}, { '$where': 'this.a > 0' });
  const { req: cleaned } = runMiddleware(req);
  // The sanitizer replaces keys starting with $ in the query object.
  const hasWhere = Object.keys(cleaned.query).some(k => k.startsWith('$'));
  assert(!hasWhere, 'parsed query object must not contain $ operator keys after sanitization');
});

test('legitimate string values are preserved', () => {
  const req = makeMockReq({ name: 'Lewis Hamilton', team: 'Mercedes', price: 100 });
  const { req: cleaned } = runMiddleware(req);
  assert.strictEqual(cleaned.body.name, 'Lewis Hamilton');
  assert.strictEqual(cleaned.body.price, 100);
});

test('legitimate dollar-sign in product name is not blocked at query level', () => {
  // Some product names may contain a $ for currency display — this goes through
  // application-level validation, not the NoSQL operator sanitizer.
  // The sanitizer targets keys, not string values.
  const req = makeMockReq({ description: 'Price: $50' });
  const { req: cleaned } = runMiddleware(req);
  assert.strictEqual(cleaned.body.description, 'Price: $50');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. server.js syntax and import validation
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] server.js validation');

const { execSync } = require('child_process');

test('server.js passes node --check', () => {
  execSync('node --check server.js', { cwd: __dirname, stdio: 'pipe' });
});

test('aiStudio.routes.js file no longer exists', () => {
  const fs = require('fs');
  const exists = fs.existsSync('routes/aiStudio.routes.js');
  assert(!exists, 'aiStudio.routes.js should have been deleted');
});

test('aiStudio.controller.js file no longer exists', () => {
  const fs = require('fs');
  const exists = fs.existsSync('controllers/aiStudio.controller.js');
  assert(!exists, 'aiStudio.controller.js should have been deleted');
});

test('server.js does not contain aiStudio route mount', () => {
  const fs = require('fs');
  const content = fs.readFileSync('server.js', 'utf8');
  assert(!content.includes("require('./routes/aiStudio.routes')"), 'aiStudio import must be removed');
  assert(!content.includes("ai-studio', aiStudioRoutes"), 'aiStudio mount must be removed');
});

test('server.js contains mongoSanitize (re-enabled)', () => {
  const fs = require('fs');
  const content = fs.readFileSync('server.js', 'utf8');
  assert(content.includes('express-mongo-sanitize'), 'mongoSanitize must be enabled');
  assert(!content.includes('//const mongoSanitize'), 'must not be commented out');
});

test('server.js contains X-Request-ID middleware', () => {
  const fs = require('fs');
  const content = fs.readFileSync('server.js', 'utf8');
  assert(content.includes('X-Request-ID'), 'request ID header must be present');
  assert(content.includes('randomUUID'), 'randomUUID must be used');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Token storage – localStorage usage detection
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] Frontend token storage audit');

const fs = require('fs');

test('api.js does not use localStorage.setItem for access token', () => {
  const apiJs = fs.readFileSync('../paddox-frontend/js/api.js', 'utf8');
  // After cookie migration, localStorage.setItem('paddox_access_token') must be removed
  assert(!apiJs.includes("localStorage.setItem('paddox_access_token'"),
    'access token must not be stored in localStorage after cookie migration');
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\nSecurity tests completed. Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
