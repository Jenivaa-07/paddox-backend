const express = require('express');
const { optionalAuth } = require('../middleware/auth.middleware');
const {
  getPersonalizedHighlights,
  trackHighlightEvent
} = require('../controllers/highlight.controller');

const router = express.Router();

router.get('/personalized', optionalAuth, getPersonalizedHighlights);
router.post('/:videoId/events', optionalAuth, trackHighlightEvent);

module.exports = router;
