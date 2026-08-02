/* ============================================================
   FILE: routes/fan.routes.js
   PADDOX — Fan Hub Routes
   Phase A4.9B.2: Admin Moderation Exact Fan Feed Connection
   ============================================================ */
const express = require('express');
const router = express.Router();
const fan = require('../controllers/fan.controller');
const FanPost = require('../models/FanPost');
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

/* Phase A4.9B.2 — Admin Moderation exact feed source
   Returns approved, flagged, and unapproved Fan Hub posts with comments so the
   Admin Moderation page can review the real community queue instead of guessing routes. */
router.get('/admin/moderation', protect, adminOnly, async (req, res, next) => {
  try {
    const posts = await FanPost.find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('user', 'firstName lastName email avatar role isBanned')
      .populate('comments.user', 'firstName lastName email avatar role isBanned')
      .lean();

    const items = [];

    posts.forEach((post) => {
      const postUser = post.user || {};
      const postUserName = `${postUser.firstName || ''} ${postUser.lastName || ''}`.trim() || postUser.email || 'Paddox Fan';

      items.push({
        key: `post:${post._id}`,
        id: String(post._id),
        postId: String(post._id),
        type: 'post',
        user: post.user,
        userName: postUserName,
        userEmail: postUser.email || '',
        text: post.text || '',
        isFlagged: !!post.isFlagged,
        isApproved: post.isApproved !== false,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        risk: post.isFlagged ? 'high' : undefined,
        reason: post.isFlagged ? 'Flagged Fan Hub post' : 'Fan Hub post review',
        source: 'Fan Hub post'
      });

      (post.comments || []).forEach((comment) => {
        const commentUser = comment.user || {};
        const commentUserName = `${commentUser.firstName || ''} ${commentUser.lastName || ''}`.trim() || commentUser.email || 'Paddox Fan';

        items.push({
          key: `comment:${post._id}:${comment._id}`,
          id: String(comment._id),
          postId: String(post._id),
          commentId: String(comment._id),
          type: 'comment',
          user: comment.user,
          userName: commentUserName,
          userEmail: commentUser.email || '',
          text: comment.text || '',
          createdAt: comment.createdAt || post.createdAt,
          risk: undefined,
          reason: 'Fan Hub comment review',
          source: 'Fan Hub comment'
        });
      });
    });

    res.json({
      success: true,
      data: {
        items,
        posts,
        total: items.length,
        postsCount: posts.length,
        commentsCount: items.filter(item => item.type === 'comment').length
      }
    });
  } catch (err) {
    next(err);
  }
});

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

/* Admin: Trivia */
router.get('/admin/trivia', protect, adminOnly, fan.adminGetTrivia);
router.post('/admin/trivia', protect, adminOnly, fan.adminCreateTrivia);
router.put('/admin/trivia/:id', protect, adminOnly, fan.adminUpdateTrivia);
router.delete('/admin/trivia/:id', protect, adminOnly, fan.adminDeleteTrivia);

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
