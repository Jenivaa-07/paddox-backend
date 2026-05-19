
/* ============================================================
   FILE: routes/auth.routes.js
   ============================================================ */
const express    = require('express');
const router     = express.Router();
const auth       = require('../controllers/auth.controller');
const { protect }= require('../middleware/auth.middleware');
const { authLimiter } = require('../middleware/rateLimit.middleware');
const { body, validationResult } = require('express-validator');

/* Validation middleware */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success:false, errors: errors.array() });
  next();
};

router.post('/register', authLimiter, [
  body('firstName').trim().notEmpty().withMessage('First name required'),
  body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
  body('password').isLength({ min:6 }).withMessage('Password min 6 characters'),
], validate, auth.register);

router.post('/login', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], validate, auth.login);

router.post('/refresh',          auth.refresh);
router.post('/logout',           protect, auth.logout);
router.get('/me',                protect, auth.getMe);
router.post('/forgot-password',  authLimiter, auth.forgotPassword);
router.post('/reset-password/:token', auth.resetPassword);

module.exports = router;

