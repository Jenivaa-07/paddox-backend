
/* ============================================================
   FILE: routes/fan.routes.js
   ============================================================ */
const express = require('express');
const router  = express.Router();
const fan     = require('../controllers/fan.controller');
const { protect, optionalAuth, adminOnly } = require('../middleware/auth.middleware');

router.get('/poll',           fan.getPoll);
router.post('/poll/vote',     protect, fan.votePoll);
router.get('/leaderboard',    fan.getLeaderboard);
router.get('/trivia',         fan.getTrivia);
router.post('/trivia/answer', optionalAuth, fan.answerTrivia);
router.get('/feed',           fan.getFeed);
router.post('/feed',          protect, fan.postToFeed);

router.get('/quotes', fan.getQuotes);
router.get('/driver-profiles', fan.getDriverProfiles);

router.get('/admin/driver-profiles', protect, adminOnly, fan.adminGetDriverProfiles);
router.post('/admin/driver-profiles', protect, adminOnly, fan.adminCreateDriverProfile);
router.put('/admin/driver-profiles/:id', protect, adminOnly, fan.adminUpdateDriverProfile);
router.delete('/admin/driver-profiles/:id', protect, adminOnly, fan.adminDeleteDriverProfile);

router.get('/admin/quotes', protect, adminOnly, fan.adminGetQuotes);
router.post('/admin/quotes', protect, adminOnly, fan.adminCreateQuote);
router.put('/admin/quotes/:id', protect, adminOnly, fan.adminUpdateQuote);
router.delete('/admin/quotes/:id', protect, adminOnly, fan.adminDeleteQuote);

module.exports = router;
