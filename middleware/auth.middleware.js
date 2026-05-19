
/* ============================================================
   FILE: middleware/auth.middleware.js  —  JWT Protect Route
   ============================================================ */
// middleware/auth.middleware.js
const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    let token;

    /* Check Authorization header */
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    /* Also check cookie */
    else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
      });
    }

    /* Verify token */
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    /* Attach user to request */
    req.user = await User.findById(decoded.id).select('-password -refreshToken');
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }
    if (req.user.isBanned) {
      return res.status(403).json({ success: false, message: 'Account suspended.' });
    }

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: err.name === 'TokenExpiredError'
        ? 'Token expired. Please refresh your session.'
        : 'Invalid token.',
    });
  }
};

/* Admin guard */
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required.',
    });
  }
  next();
};

/* Optional auth — attaches user if token present, does not block */
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.cookies?.accessToken;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      req.user = await User.findById(decoded.id).select('-password -refreshToken');
    }
  } catch { /* ignore */ }
  next();
};

module.exports = { protect, adminOnly, optionalAuth };

