
/* ============================================================
   FILE: utils/generateToken.js  —  JWT Token Helpers
   Phase 7: Access token delivered as HttpOnly cookie only.
   The access token value is never returned in response body.
   ============================================================ */
const jwt = require('jsonwebtoken');

/**
 * Generate access token (short-lived: 15m)
 */
const generateAccessToken = (id, role = 'user') => {
  return jwt.sign(
    { id, role },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRE || '15m' }
  );
};

/**
 * Generate refresh token (long-lived: 7d)
 */
const generateRefreshToken = (id) => {
  return jwt.sign(
    { id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
  );
};

/**
 * Determine SameSite policy.
 *
 * Vercel frontend + Render backend = cross-site in production.
 * Use SameSite=None; Secure for credentialed cross-site requests.
 * In local dev, use Lax (same-site localhost:5500 → localhost:5000).
 *
 * LIMITATION: SameSite=None requires Secure, and some browsers
 * block third-party cookies in certain contexts. Document this
 * limitation in OPERATIONS.md.
 */
const getCookieOptions = (maxAgeMs, isProduction) => ({
  httpOnly: true,
  secure  : isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge  : maxAgeMs,
});

/**
 * Set access token as HttpOnly cookie (short-lived: 15m).
 * Path '/' so it is sent on all API routes.
 * The token value is NEVER returned in the response body.
 */
const setAccessCookie = (res, accessToken) => {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('accessToken', accessToken, {
    ...getCookieOptions(15 * 60 * 1000, isProduction),
    path: '/',
  });
};

/**
 * Set refresh token as HttpOnly cookie (long-lived: 7d).
 * Scoped to /api/auth to minimise exposure surface.
 */
const setRefreshCookie = (res, refreshToken) => {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('refreshToken', refreshToken, {
    ...getCookieOptions(7 * 24 * 60 * 60 * 1000, isProduction),
    path: '/api/auth',
  });
};

/**
 * Clear both cookies on logout.
 */
const clearRefreshCookie = (res) => {
  res.clearCookie('refreshToken', { path: '/api/auth' });
};

const clearAccessCookie = (res) => {
  res.clearCookie('accessToken', { path: '/' });
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  setAccessCookie,
  setRefreshCookie,
  clearAccessCookie,
  clearRefreshCookie,
};
