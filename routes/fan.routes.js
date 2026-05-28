/* ============================================================
   FILE: routes/fan.routes.js
   PADDOX — Fan Hub Routes
   ============================================================ */
const express = require('express');
const router = express.Router();
const fan = require('../controllers/fan.controller');
const { protect, optionalAuth, adminOnly } = require('../middleware/auth.middleware');

/* Public / user Fan Hub */
router.get('/poll', fan.getPoll);
router.post('/poll/vote', protect, fan.votePoll);
router.get('/leaderboard', fan.getLeaderboard);
router.get('/trivia', fan.getTrivia);
router.post('/trivia/answer', optionalAuth, fan.answerTrivia);
router.get('/feed', optionalAuth, fan.getFeed);
router.post('/feed', protect, fan.postToFeed);
router.post('/feed/:id/like', protect, fan.toggleFeedLike);
router.post('/feed/:id/comments', protect, fan.addFeedComment);
router.delete('/feed/:id/comments/:commentId', protect, fan.deleteFeedComment);
router.delete('/feed/:id', protect, fan.deleteFeedPost);

/* Quotes / drivers / home branding */
router.get('/quotes', fan.getQuotes);
router.get('/driver-profiles', fan.getDriverProfiles);
router.get('/home-marquee-logos', fan.getHomeMarqueeLogos);

/* Admin: Fan Polls */
router.get('/admin/polls', protect, adminOnly, fan.adminGetPolls);
router.post('/admin/polls', protect, adminOnly, fan.adminCreatePoll);
router.put('/admin/polls/:id', protect, adminOnly, fan.adminUpdatePoll);
router.delete('/admin/polls/:id', protect, adminOnly, fan.adminDeletePoll);
router.put('/admin/polls/:id/active', protect, adminOnly, fan.adminSetActivePoll);
router.patch('/admin/polls/:id/active', protect, adminOnly, fan.adminSetActivePoll);

/* Admin: Home Marquee Logos */
router.get('/admin/home-marquee-logos', protect, adminOnly, fan.adminGetHomeMarqueeLogos);
router.post('/admin/home-marquee-logos', protect, adminOnly, fan.adminCreateHomeMarqueeLogo);
router.put('/admin/home-marquee-logos/:id', protect, adminOnly, fan.adminUpdateHomeMarqueeLogo);
router.delete('/admin/home-marquee-logos/:id', protect, adminOnly, fan.adminDeleteHomeMarqueeLogo);

/* Admin: Driver Profiles */
router.get('/admin/driver-profiles', protect, adminOnly, fan.adminGetDriverProfiles);
router.post('/admin/driver-profiles', protect, adminOnly, fan.adminCreateDriverProfile);
router.put('/admin/driver-profiles/:id', protect, adminOnly, fan.adminUpdateDriverProfile);
router.delete('/admin/driver-profiles/:id', protect, adminOnly, fan.adminDeleteDriverProfile);

/* Admin: Quotes */
router.get('/admin/quotes', protect, adminOnly, fan.adminGetQuotes);
router.post('/admin/quotes', protect, adminOnly, fan.adminCreateQuote);
router.put('/admin/quotes/:id', protect, adminOnly, fan.adminUpdateQuote);
router.delete('/admin/quotes/:id', protect, adminOnly, fan.adminDeleteQuote);

module.exports = router;
