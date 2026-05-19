
/* ============================================================
   FILE: controllers/fan.controller.js
   ============================================================ */
const Poll       = require('../models/Poll');
const Trivia     = require('../models/Trivia');
const FanPost    = require('../models/FanPost');
const FanPoints  = require('../models/FanPoints');
const User       = require('../models/User');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { getIO } = require('../config/socket');

/* ── GET ACTIVE POLL ── */
exports.getPoll = async (req, res, next) => {
  try {
    const poll = await Poll.findOne({ isActive:true }).sort('-createdAt');
    if (!poll) return errorResponse(res, 404, 'No active poll');
    const totalVotes = poll.options.reduce((s,o) => s + o.votes, 0);
    const options    = poll.options.map(o => ({
      ...o.toObject(),
      percentage: totalVotes > 0 ? Math.round((o.votes / totalVotes) * 100) : 0,
    }));
    successResponse(res, 200, 'Poll fetched', { poll:{ ...poll.toObject(), options }, totalVotes });
  } catch (err) { next(err); }
};

/* ── VOTE ON POLL ── */
exports.votePoll = async (req, res, next) => {
  try {
    const { pollId, optionIndex } = req.body;
    const poll = await Poll.findById(pollId);
    if (!poll || !poll.isActive)     return errorResponse(res, 404, 'Poll not found or closed');
    if (poll.voters.includes(req.user._id)) return errorResponse(res, 400, 'You have already voted');
    if (optionIndex < 0 || optionIndex >= poll.options.length) return errorResponse(res, 400, 'Invalid option');

    poll.options[optionIndex].votes += 1;
    poll.voters.push(req.user._id);
    await poll.save();

    /* Award fan points */
    await FanPoints.create({ user:req.user._id, action:'poll_vote', points:50, meta:{ pollId } });
    await User.findByIdAndUpdate(req.user._id, { $inc:{ fanPoints:50 } });

    /* Broadcast updated results */
    const totalVotes = poll.options.reduce((s,o) => s + o.votes, 0);
    const options    = poll.options.map(o => ({ ...o.toObject(), percentage: Math.round((o.votes/totalVotes)*100) }));
    try { getIO().emit('poll:vote-update', { pollId, options, totalVotes }); } catch {}

    successResponse(res, 200, 'Vote recorded! +50 Fan Points', { options, totalVotes });
  } catch (err) { next(err); }
};

/* ── GET LEADERBOARD ── */
exports.getLeaderboard = async (req, res, next) => {
  try {
    const users = await User.find({ isBanned:false })
      .select('firstName lastName avatar fanPoints fanTier')
      .sort('-fanPoints')
      .limit(20);
    const leaderboard = users.map((u, i) => ({
      rank      : i + 1,
      name      : `${u.firstName} ${u.lastName || ''}`.trim(),
      avatar    : u.avatar?.url || '',
      fanPoints : u.fanPoints,
      fanTier   : u.fanTier,
    }));
    successResponse(res, 200, 'Leaderboard fetched', { leaderboard });
  } catch (err) { next(err); }
};

/* ── GET RANDOM TRIVIA ── */
exports.getTrivia = async (req, res, next) => {
  try {
    const { difficulty, category } = req.query;
    const query = { isActive:true };
    if (difficulty) query.difficulty = difficulty;
    if (category)   query.category   = category;

    const count   = await Trivia.countDocuments(query);
    const random  = Math.floor(Math.random() * count);
    const trivia  = await Trivia.findOne(query).skip(random).select('-correctIndex -__v');
    if (!trivia) return errorResponse(res, 404, 'No trivia found');
    successResponse(res, 200, 'Trivia question fetched', { trivia });
  } catch (err) { next(err); }
};

/* ── ANSWER TRIVIA ── */
exports.answerTrivia = async (req, res, next) => {
  try {
    const { triviaId, answerIndex } = req.body;
    const trivia = await Trivia.findById(triviaId);
    if (!trivia) return errorResponse(res, 404, 'Trivia not found');

    const correct = answerIndex === trivia.correctIndex;
    let pointsEarned = 0;

    if (correct && req.user) {
      pointsEarned = trivia.points;
      await FanPoints.create({ user:req.user._id, action:'trivia', points:pointsEarned, meta:{ triviaId } });
      await User.findByIdAndUpdate(req.user._id, { $inc:{ fanPoints:pointsEarned } });
    }

    successResponse(res, 200, correct ? '✓ Correct!' : '✗ Wrong!', {
      correct,
      correctIndex : trivia.correctIndex,
      correctAnswer: trivia.options[trivia.correctIndex],
      pointsEarned,
    });
  } catch (err) { next(err); }
};

/* ── GET FAN FEED ── */
exports.getFeed = async (req, res, next) => {
  try {
    const { page=1, limit=20 } = req.query;
    const posts = await FanPost.find({ isApproved:true, isFlagged:false })
      .sort('-createdAt')
      .skip((page-1)*limit)
      .limit(Number(limit))
      .populate('user','firstName lastName avatar');
    successResponse(res, 200, 'Fan feed fetched', { posts });
  } catch (err) { next(err); }
};

/* ── POST TO FAN FEED ── */
exports.postToFeed = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return errorResponse(res, 400, 'Post text required');

    const post = await FanPost.create({ user:req.user._id, text:text.slice(0,280) });
    await post.populate('user','firstName lastName avatar');

    /* Broadcast via WebSocket */
    try {
      getIO().emit('fan:new-post', {
        user  : post.user.firstName,
        text  : post.text,
        time  : 'Just now',
        avatar: post.user.avatar?.url || '👤',
      });
    } catch {}

    /* Award fan points */
    await FanPoints.create({ user:req.user._id, action:'fan_post', points:20, meta:{ postId:post._id } });
    await User.findByIdAndUpdate(req.user._id, { $inc:{ fanPoints:20 } });

    successResponse(res, 201, 'Posted! +20 Fan Points', { post });
  } catch (err) { next(err); }
};
