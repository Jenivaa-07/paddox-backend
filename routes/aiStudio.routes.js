/* ============================================================
   FILE: routes/aiStudio.routes.js
   PADDOX — AI Prompt Studio Routes
   Phase A4.11N.2
   ============================================================ */
const express = require('express');
const router = express.Router();
const aiStudio = require('../controllers/aiStudio.controller');
const auth = require('../middleware/auth.middleware') || {};

function unavailableAuth(req, res) {
  return res.status(503).json({ success:false, message:'Authentication middleware is unavailable' });
}
const protect =
  typeof auth.protect === 'function'
    ? auth.protect
    : typeof auth.authMiddleware === 'function'
      ? auth.authMiddleware
      : unavailableAuth;

router.get('/credits', protect, aiStudio.getCredits);
router.post('/generate', protect, aiStudio.generatePoster);
router.post('/upload-result', protect, aiStudio.uploadResult);
router.get('/gallery', protect, aiStudio.getMyPosters);

module.exports = router;
