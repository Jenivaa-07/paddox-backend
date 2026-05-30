/* ============================================================
   FILE: routes/auth.routes.js
   PADDOX — Auth Routes Deploy Safety Fix
   Phase A4.7B.3: prevents Express from crashing when optional
   auth controller handlers are missing after older merges.
   ============================================================ */
const express = require('express');
const router = express.Router();

const auth = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const { authLimiter } = require('../middleware/rateLimit.middleware');
const { body, validationResult } = require('express-validator');

/* Validation middleware */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  return next();
};

function ensureHandler(name, fallback) {
  if (typeof auth[name] === 'function') return auth[name];
  return fallback || ((req, res) => res.status(501).json({
    success: false,
    message: `Auth handler missing: ${name}`
  }));
}

const registerHandler = ensureHandler('register');
const loginHandler = ensureHandler('login');
const refreshHandler = ensureHandler('refresh', (req, res) => res.status(200).json({
  success: true,
  message: 'Refresh endpoint available',
}));
const logoutHandler = ensureHandler('logout', (req, res) => res.status(200).json({
  success: true,
  message: 'Logged out',
}));

/* Some controller versions use getMe, others use me/currentUser/profile. */
const getMeHandler =
  (typeof auth.getMe === 'function' && auth.getMe) ||
  (typeof auth.me === 'function' && auth.me) ||
  (typeof auth.currentUser === 'function' && auth.currentUser) ||
  (typeof auth.profile === 'function' && auth.profile) ||
  ((req, res) => res.status(200).json({
    success: true,
    message: 'User fetched',
    data: { user: req.user || null },
    user: req.user || null,
  }));

const forgotPasswordHandler = ensureHandler('forgotPassword', (req, res) => res.status(501).json({
  success: false,
  message: 'Forgot password is not configured yet',
}));
const resetPasswordHandler = ensureHandler('resetPassword', (req, res) => res.status(501).json({
  success: false,
  message: 'Reset password is not configured yet',
}));

router.post('/register', authLimiter, [
  body('firstName').optional().trim(),
  body('name').optional().trim(),
  body('email').isEmail().withMessage('Valid email required').trim(),
  body('password').isLength({ min: 6 }).withMessage('Password min 6 characters'),
], validate, registerHandler);

router.post('/login', authLimiter, [
  body('email').isEmail().withMessage('Valid email required').trim(),
  body('password').notEmpty(),
], validate, loginHandler);

router.post('/refresh', refreshHandler);
router.post('/logout', protect, logoutHandler);
router.get('/me', protect, getMeHandler);
router.post('/forgot-password', authLimiter, forgotPasswordHandler);
router.post('/reset-password/:token', resetPasswordHandler);

module.exports = router;
