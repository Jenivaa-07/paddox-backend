
/* ============================================================
   FILE: routes/fan.routes.js
   ============================================================ */
const express = require('express');
const router  = express.Router();
const fan     = require('../controllers/fan.controller');
const { protect, optionalAuth } = require('../middleware/auth.middleware');

router.get('/poll',           fan.getPoll);
router.post('/poll/vote',     protect, fan.votePoll);
router.get('/leaderboard',    fan.getLeaderboard);
router.get('/trivia',         fan.getTrivia);
router.post('/trivia/answer', optionalAuth, fan.answerTrivia);
router.get('/feed',           fan.getFeed);
router.post('/feed',          protect, fan.postToFeed);

module.exports = router;
