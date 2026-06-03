/* ============================================================
   FILE: routes/aiStudio.routes.js
   PADDOX — AI Fan Studio Routes
   Phase A4.11C
   ============================================================ */
const express = require('express');
const router = express.Router();
const aiStudio = require('../controllers/aiStudio.controller');
const auth = require('../middleware/auth.middleware') || {};

function noopProtect(req, res, next) { return next(); }
const protect =
  typeof auth.protect === 'function'
    ? auth.protect
    : typeof auth.authMiddleware === 'function'
      ? auth.authMiddleware
      : noopProtect;

router.get('/credits', protect, aiStudio.getCredits);
router.post('/generate', protect, aiStudio.generatePoster);
router.post('/upload-result', protect, aiStudio.uploadResult);
router.get('/gallery', protect, aiStudio.getMyPosters);

module.exports = router;
