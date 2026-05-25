/* ============================================================
   FILE: controllers/fan.controller.js
   PADDOX — REALTIME FAN HUB CONTROLLER
   ============================================================ */
const Poll       = require('../models/Poll');
const Trivia     = require('../models/Trivia');
const FanPost    = require('../models/FanPost');
const FanPoints  = require('../models/FanPoints');
const User       = require('../models/User');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { getIO } = require('../config/socket');

function serverError(res, err, label = 'Server error') {
  console.error(label, err);
  return res.status(500).json({
    success: false,
    message: err.message || label
  });
}

function publicPost(post) {
  const obj = post.toObject ? post.toObject() : post;
  return obj;
}

async function ensureDefaultPoll() {
  let poll = await Poll.findOne({ isActive:true }).sort('-createdAt');

  if (!poll) {
    poll = await Poll.create({
      question: "Who will win the next Grand Prix?",
      options: [
        { label: 'Max Verstappen 🔵', votes: 0 },
        { label: 'Charles Leclerc 🔴', votes: 0 },
        { label: 'Lando Norris 🟠', votes: 0 },
        { label: 'Lewis Hamilton ⭐', votes: 0 }
      ],
      isActive: true
    });
  }

  return poll;
}

async function ensureDefaultTrivia() {
  const count = await Trivia.countDocuments({ isActive:true });

  if (count > 0) return;

  await Trivia.insertMany([
    {
      question: 'Which driver holds the joint record for most F1 World Championships?',
      options: ['Ayrton Senna', 'Lewis Hamilton', 'Fernando Alonso', 'Nico Rosberg'],
      correctIndex: 1,
      difficulty: 'medium',
      points: 100,
      category: 'drivers',
      isActive: true
    },
    {
      question: 'What does DRS stand for?',
      options: ['Driver Racing System', 'Drag Reduction System', 'Dynamic Race Setup', 'Downforce Recovery System'],
      correctIndex: 1,
      difficulty: 'easy',
      points: 75,
      category: 'rules',
      isActive: true
    },
    {
      question: 'Which circuit is commonly called The Temple of Speed?',
      options: ['Silverstone', 'Monaco', 'Monza', 'Suzuka'],
      correctIndex: 2,
      difficulty: 'medium',
      points: 100,
      category: 'circuits',
      isActive: true
    }
  ]);
}

/* ── GET ACTIVE POLL ── */
exports.getPoll = async (req, res) => {
  try {
    const poll = await ensureDefaultPoll();

    const totalVotes =
      poll.options.reduce((s, o) => s + Number(o.votes || 0), 0);

    const options =
      poll.options.map(o => ({
        ...o.toObject(),
        percentage:
          totalVotes > 0
            ? Math.round((Number(o.votes || 0) / totalVotes) * 100)
            : 0
      }));

    return successResponse(
      res,
      200,
      'Poll fetched',
      {
        poll: {
          ...poll.toObject(),
          options
        },
        totalVotes
      }
    );

  } catch (err) {
    return serverError(res, err, 'Get poll failed');
  }
};

/* ── VOTE ON POLL ── */
exports.votePoll = async (req, res) => {
  try {
    const { pollId, optionIndex } = req.body;

    const poll = await Poll.findById(pollId);

    if (!poll || !poll.isActive) {
      return errorResponse(res, 404, 'Poll not found or closed');
    }

    const idx = Number(optionIndex);

    if (Number.isNaN(idx) || idx < 0 || idx >= poll.options.length) {
      return errorResponse(res, 400, 'Invalid option');
    }

    const alreadyVoted =
      poll.voters.some(v => String(v) === String(req.user._id));

    if (alreadyVoted) {
      return errorResponse(res, 400, 'You have already voted');
    }

    poll.options[idx].votes += 1;
    poll.voters.push(req.user._id);

    await poll.save();

    await FanPoints.create({
      user: req.user._id,
      action: 'poll_vote',
      points: 50,
      meta: { pollId }
    });

    await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { fanPoints: 50 } }
    );

    const totalVotes =
      poll.options.reduce((s, o) => s + Number(o.votes || 0), 0);

    const options =
      poll.options.map(o => ({
        ...o.toObject(),
        percentage:
          totalVotes > 0
            ? Math.round((Number(o.votes || 0) / totalVotes) * 100)
            : 0
      }));

    try {
      getIO().emit('poll:vote-update', {
        pollId,
        options,
        totalVotes
      });
    } catch {}

    return successResponse(
      res,
      200,
      'Vote recorded! +50 Fan Points',
      { options, totalVotes }
    );

  } catch (err) {
    return serverError(res, err, 'Vote poll failed');
  }
};

/* ── GET LEADERBOARD ── */
exports.getLeaderboard = async (req, res) => {
  try {
    const users =
      await User.find({ isBanned:false })
        .select('firstName lastName avatar fanPoints fanTier')
        .sort('-fanPoints')
        .limit(20);

    const leaderboard =
      users.map((u, i) => ({
        rank      : i + 1,
        name      : `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Paddox Fan',
        avatar    : u.avatar?.url || '',
        fanPoints : u.fanPoints || 0,
        fanTier   : u.fanTier || '',
      }));

    return successResponse(
      res,
      200,
      'Leaderboard fetched',
      { leaderboard }
    );

  } catch (err) {
    return serverError(res, err, 'Get leaderboard failed');
  }
};

/* ── GET RANDOM TRIVIA ── */
exports.getTrivia = async (req, res) => {
  try {
    await ensureDefaultTrivia();

    const { difficulty, category } = req.query;

    const query = { isActive:true };

    if (difficulty) query.difficulty = difficulty;
    if (category) query.category = category;

    const count = await Trivia.countDocuments(query);

    if (!count) {
      return errorResponse(res, 404, 'No trivia found');
    }

    const random =
      Math.floor(Math.random() * count);

    const trivia =
      await Trivia.findOne(query)
        .skip(random)
        .select('-correctIndex -__v');

    return successResponse(
      res,
      200,
      'Trivia question fetched',
      { trivia }
    );

  } catch (err) {
    return serverError(res, err, 'Get trivia failed');
  }
};

/* ── ANSWER TRIVIA ── */
exports.answerTrivia = async (req, res) => {
  try {
    const { triviaId, answerIndex } = req.body;

    const trivia =
      await Trivia.findById(triviaId);

    if (!trivia) {
      return errorResponse(res, 404, 'Trivia not found');
    }

    const correct =
      Number(answerIndex) === Number(trivia.correctIndex);

    let pointsEarned = 0;

    if (correct && req.user) {
      pointsEarned = trivia.points || 100;

      await FanPoints.create({
        user: req.user._id,
        action: 'trivia',
        points: pointsEarned,
        meta: { triviaId }
      });

      await User.findByIdAndUpdate(
        req.user._id,
        { $inc: { fanPoints: pointsEarned } }
      );
    }

    return successResponse(
      res,
      200,
      correct ? '✓ Correct!' : '✗ Wrong!',
      {
        correct,
        correctIndex  : trivia.correctIndex,
        correctAnswer : trivia.options[trivia.correctIndex],
        pointsEarned,
      }
    );

  } catch (err) {
    return serverError(res, err, 'Answer trivia failed');
  }
};

/* ── GET FAN FEED ── */
exports.getFeed = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20
    } = req.query;

    const posts =
      await FanPost.find({
        isApproved:true,
        isFlagged:false
      })
        .sort('-createdAt')
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit))
        .populate('user','firstName lastName avatar');

    return successResponse(
      res,
      200,
      'Fan feed fetched',
      { posts }
    );

  } catch (err) {
    return serverError(res, err, 'Get fan feed failed');
  }
};

/* ── POST TO FAN FEED ── */
exports.postToFeed = async (req, res) => {
  try {
    const { text } = req.body;

    const cleanText =
      String(text || '').trim().slice(0, 280);

    if (!cleanText) {
      return errorResponse(res, 400, 'Post text required');
    }

    const post =
      await FanPost.create({
        user: req.user._id,
        text: cleanText
      });

    await post.populate('user','firstName lastName avatar');

    await FanPoints.create({
      user: req.user._id,
      action: 'fan_post',
      points: 20,
      meta: { postId: post._id }
    });

    await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { fanPoints: 20 } }
    );

    try {
      getIO().emit('fan:new-post', {
        user   : post.user.firstName || 'Paddox Fan',
        text   : post.text,
        time   : 'Just now',
        avatar : post.user.avatar?.url || '',
      });
    } catch {}

    return successResponse(
      res,
      201,
      'Posted! +20 Fan Points',
      { post: publicPost(post) }
    );

  } catch (err) {
    return serverError(res, err, 'Post fan feed failed');
  }
};
