const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { VALID_EVENTS, rankHighlights } = require('../services/highlightRecommendation.service');

exports.getPersonalizedHighlights = async (req, res) => {
  try {
    const preferences = req.user?.preferences || {};
    const activity = req.user?.highlightActivity || [];
    const guestSeen = String(req.query.seen || '').split(',').filter(Boolean).slice(0, 30);
    const highlights = rankHighlights({
      preferences,
      activity,
      guestSeen,
      limit: req.query.limit,
      seed: String(req.user?._id || req.get('X-Paddox-Session-Id') || 'guest')
    });

    return successResponse(res, 200, 'Highlights ready', {
      highlights,
      personalized: !!req.user && !!(preferences.favouriteTeam || preferences.favouriteDriver || activity.length),
      preferenceSummary: req.user ? {
        favouriteTeam: preferences.favouriteTeam || '',
        favouriteDriver: preferences.favouriteDriver || ''
      } : null
    });
  } catch (err) {
    console.error('Highlight recommendation failed:', err.message);
    return errorResponse(res, 500, 'Could not load highlights');
  }
};

exports.trackHighlightEvent = async (req, res) => {
  try {
    const videoId = String(req.params.videoId || '').trim();
    const event = String(req.body?.event || '').toLowerCase();

    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return errorResponse(res, 400, 'Invalid YouTube video ID');
    }
    if (!VALID_EVENTS.has(event)) {
      return errorResponse(res, 400, 'Unsupported highlight event');
    }
    if (!req.user) {
      return successResponse(res, 200, 'Guest event kept on this device', { saved: false });
    }

    const user = await User.findById(req.user._id).select('highlightActivity');
    if (!user) return errorResponse(res, 404, 'User not found');

    const existing = user.highlightActivity.find(item => item.videoId === videoId);
    if (existing) {
      existing.event = event;
      existing.count = Number(existing.count || 0) + 1;
      existing.lastAt = new Date();
    } else {
      user.highlightActivity.push({ videoId, event, count: 1, lastAt: new Date() });
    }

    user.highlightActivity = user.highlightActivity
      .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt))
      .slice(0, 100);
    await user.save({ validateBeforeSave: false });

    return successResponse(res, 200, 'Highlight preference updated', { saved: true });
  } catch (err) {
    console.error('Highlight event tracking failed:', err.message);
    return errorResponse(res, 500, 'Could not save highlight preference');
  }
};
