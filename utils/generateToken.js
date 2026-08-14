
/* ============================================================
   FILE: utils/generateToken.js  —  JWT Token Helpers
   ============================================================ */
// utils/generateToken.js
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

const productionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // Production traffic reaches the API through the same-origin Vercel /api
  // rewrite, so strict cookies work without third-party-cookie exceptions.
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
});

/**
 * Set the short-lived access token as an HttpOnly cookie.
 */
const setAccessCookie = (res, accessToken) => {
  res.cookie('accessToken', accessToken, {
    ...productionCookieOptions(),
    maxAge: 15 * 60 * 1000,
    path: '/api',
  });
};

/**
 * Set refresh token as httpOnly cookie
 */
const setRefreshCookie = (res, refreshToken) => {
  res.cookie('refreshToken', refreshToken, {
    ...productionCookieOptions(),
    maxAge  : 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    path    : '/api/auth',
  });
};

const clearAccessCookie = (res) => {
  res.clearCookie('accessToken', {
    ...productionCookieOptions(),
    path: '/api',
  });
};

/**
 * Clear refresh token cookie
 */
const clearRefreshCookie = (res) => {
  res.clearCookie('refreshToken', {
    ...productionCookieOptions(),
    path: '/api/auth',
  });
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  setAccessCookie,
  setRefreshCookie,
  clearAccessCookie,
  clearRefreshCookie,
};
