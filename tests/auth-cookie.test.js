const test = require('node:test');
const assert = require('node:assert/strict');

const {
  setAccessCookie,
  setRefreshCookie,
  clearAccessCookie,
  clearRefreshCookie,
} = require('../utils/generateToken');

function responseSpy() {
  const calls = { set: [], clear: [] };
  return {
    calls,
    cookie(name, value, options) { calls.set.push({ name, value, options }); },
    clearCookie(name, options) { calls.clear.push({ name, options }); },
  };
}

test('production auth cookies are HttpOnly, secure, same-site, and scoped', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const res = responseSpy();

  setAccessCookie(res, 'access-value');
  setRefreshCookie(res, 'refresh-value');

  assert.deepEqual(res.calls.set.map(({ name, options }) => ({
    name,
    httpOnly: options.httpOnly,
    secure: options.secure,
    sameSite: options.sameSite,
    path: options.path,
  })), [
    { name: 'accessToken', httpOnly: true, secure: true, sameSite: 'strict', path: '/api' },
    { name: 'refreshToken', httpOnly: true, secure: true, sameSite: 'strict', path: '/api/auth' },
  ]);

  process.env.NODE_ENV = previous;
});

test('cookie clearing uses the same paths and security attributes', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const res = responseSpy();

  clearAccessCookie(res);
  clearRefreshCookie(res);

  assert.deepEqual(res.calls.clear.map(({ name, options }) => ({
    name,
    path: options.path,
    secure: options.secure,
    sameSite: options.sameSite,
  })), [
    { name: 'accessToken', path: '/api', secure: true, sameSite: 'strict' },
    { name: 'refreshToken', path: '/api/auth', secure: true, sameSite: 'strict' },
  ]);

  process.env.NODE_ENV = previous;
});
