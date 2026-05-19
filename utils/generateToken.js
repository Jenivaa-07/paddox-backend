
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

/**
 * Set refresh token as httpOnly cookie
 */
const setRefreshCookie = (res, refreshToken) => {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure  : isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge  : 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    path    : '/api/auth',
  });
};

/**
 * Clear refresh token cookie
 */
const clearRefreshCookie = (res) => {
  res.clearCookie('refreshToken', { path: '/api/auth' });
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
};
