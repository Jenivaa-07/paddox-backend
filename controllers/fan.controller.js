/* ============================================================
   FILE: controllers/fan.controller.js
   PADDOX — REALTIME FAN HUB CONTROLLER
   ============================================================ */
const Poll       = require('../models/Poll');
const Trivia     = require('../models/Trivia');
const FanPost    = require('../models/FanPost');
const FanPoints  = require('../models/FanPoints');
const User       = require('../models/User');
const Quote      = require('../models/Quote');
const FanDriverProfile = require('../models/FanDriverProfile');
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


/* ── DEFAULT QUOTES SEED ── */
async function ensureDefaultQuotes() {
  const count = await Quote.countDocuments();

  if (count > 0) return;

  await Quote.insertMany([
    { text:'When you are fitted in a racing car and you race to win, second or third place is not enough.', driver:'Ayrton Senna', team:'McLaren / Lotus / Williams', era:'legend', category:'champions', avatar:'🇧🇷', isFeatured:true },
    { text:'The moment money becomes your motivation, you are immediately not as good as someone who is stimulated by passion.', driver:'Sebastian Vettel', team:'Red Bull / Ferrari / Aston Martin', era:'legend', category:'motivation', avatar:'🇩🇪', isFeatured:true },
    { text:'I do not aspire to be like other drivers. I aspire to be unique in my own way.', driver:'Lewis Hamilton', team:'Mercedes / Ferrari', era:'current', category:'champions', avatar:'⭐', isFeatured:true },
    { text:'I always believe I can improve. That is the mindset you need in Formula 1.', driver:'Max Verstappen', team:'Oracle Red Bull Racing', era:'current', category:'current-grid', avatar:'🔵', isFeatured:true },
    { text:'Monaco is special. You need confidence, precision and a little bit of magic.', driver:'Charles Leclerc', team:'Scuderia Ferrari', era:'current', category:'race-weekend', avatar:'🔴' },
    { text:'You cannot always control the result, but you can control how much you push.', driver:'Lando Norris', team:'McLaren F1 Team', era:'current', category:'motivation', avatar:'🟠' },
    { text:'Experience teaches you where to take risk and where to be patient.', driver:'Fernando Alonso', team:'Aston Martin F1', era:'current', category:'racecraft', avatar:'🟢' },
    { text:'To finish first, first you have to finish.', driver:'Juan Manuel Fangio', team:'F1 Legend', era:'legend', category:'historic', avatar:'🏆' },
    { text:'I was always racing for myself, not against anyone else.', driver:'Niki Lauda', team:'Ferrari / McLaren', era:'legend', category:'historic', avatar:'🇦🇹' },
    { text:'Racing is life. Everything before or after is just waiting.', driver:'Steve McQueen', team:'Racing Icon', era:'legend', category:'historic', avatar:'🎬' },
    { text:'Every lap is a new chance to understand the car better.', driver:'Oscar Piastri', team:'McLaren F1 Team', era:'current', category:'current-grid', avatar:'🟠' },
    { text:'Pressure is part of racing. You learn to turn it into focus.', driver:'George Russell', team:'Mercedes-AMG Petronas', era:'current', category:'motivation', avatar:'⚫' },
    { text:'The best races are won before the lights go out — in preparation.', driver:'Carlos Sainz', team:'Williams / Ferrari', era:'current', category:'racecraft', avatar:'🔵' },
    { text:'In Formula 1, small details become big differences.', driver:'Kimi Räikkönen', team:'Ferrari / McLaren / Sauber', era:'legend', category:'racecraft', avatar:'🇫🇮' },
    { text:'Sometimes you need to trust the car, sometimes the car needs to trust you.', driver:'Daniel Ricciardo', team:'F1 Driver', era:'legend', category:'motivation', avatar:'🇦🇺' }
  ]);
}

/* ── GET QUOTES ── */
exports.getQuotes = async (req, res) => {
  try {
    await ensureDefaultQuotes();

    const {
      era,
      category,
      search,
      limit = 100
    } = req.query;

    const query = { isActive: true };

    if (era && era !== 'all') query.era = era;
    if (category && category !== 'all') query.category = category;

    if (search) {
      query.$text = { $search: search };
    }

    const quotes =
      await Quote.find(query)
        .sort({ isFeatured: -1, createdAt: -1 })
        .limit(Number(limit));

    return successResponse(
      res,
      200,
      'Quotes fetched',
      { quotes }
    );

  } catch (err) {
    return serverError(res, err, 'Get quotes failed');
  }
};

/* ── ADMIN GET ALL QUOTES ── */
exports.adminGetQuotes = async (req, res) => {
  try {
    await ensureDefaultQuotes();

    const quotes =
      await Quote.find()
        .sort({ createdAt: -1 })
        .limit(300);

    return successResponse(
      res,
      200,
      'Admin quotes fetched',
      { quotes }
    );

  } catch (err) {
    return serverError(res, err, 'Admin get quotes failed');
  }
};

/* ── ADMIN CREATE QUOTE ── */
exports.adminCreateQuote = async (req, res) => {
  try {
    const payload = {
      text: String(req.body.text || '').trim(),
      driver: String(req.body.driver || '').trim(),
      team: String(req.body.team || '').trim(),
      era: req.body.era || 'current',
      category: String(req.body.category || 'motivation').trim(),
      avatar: String(req.body.avatar || '🏎️').trim(),
      source: String(req.body.source || '').trim(),
      isFeatured: !!req.body.isFeatured,
      isActive: req.body.isActive !== false,
      createdBy: req.user?._id
    };

    if (!payload.text || !payload.driver) {
      return errorResponse(res, 400, 'Quote text and driver required');
    }

    const quote = await Quote.create(payload);

    return successResponse(
      res,
      201,
      'Quote created',
      { quote }
    );

  } catch (err) {
    return serverError(res, err, 'Create quote failed');
  }
};

/* ── ADMIN UPDATE QUOTE ── */
exports.adminUpdateQuote = async (req, res) => {
  try {
    const allowed = [
      'text',
      'driver',
      'team',
      'era',
      'category',
      'avatar',
      'source',
      'isFeatured',
      'isActive'
    ];

    const payload = {};

    allowed.forEach(key => {
      if (req.body[key] !== undefined) payload[key] = req.body[key];
    });

    if (payload.text !== undefined) payload.text = String(payload.text).trim();
    if (payload.driver !== undefined) payload.driver = String(payload.driver).trim();

    const quote =
      await Quote.findByIdAndUpdate(
        req.params.id,
        payload,
        {
          new: true,
          runValidators: true
        }
      );

    if (!quote) {
      return errorResponse(res, 404, 'Quote not found');
    }

    return successResponse(
      res,
      200,
      'Quote updated',
      { quote }
    );

  } catch (err) {
    return serverError(res, err, 'Update quote failed');
  }
};

/* ── ADMIN DELETE QUOTE ── */
exports.adminDeleteQuote = async (req, res) => {
  try {
    const quote =
      await Quote.findByIdAndDelete(req.params.id);

    if (!quote) {
      return errorResponse(res, 404, 'Quote not found');
    }

    return successResponse(
      res,
      200,
      'Quote deleted'
    );

  } catch (err) {
    return serverError(res, err, 'Delete quote failed');
  }
};


/* ── DRIVER PROFILE OVERRIDES ── */
function makeDriverKey(name = '', code = '') {
  return String(code || name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

exports.getDriverProfiles = async (req, res) => {
  try {
    const profiles = await FanDriverProfile.find({ isActive:true }).sort({ name: 1 });
    return successResponse(res, 200, 'Driver profiles fetched', { profiles });
  } catch (err) {
    return serverError(res, err, 'Get driver profiles failed');
  }
};

exports.adminGetDriverProfiles = async (req, res) => {
  try {
    const profiles = await FanDriverProfile.find().sort({ updatedAt: -1 }).limit(300);
    return successResponse(res, 200, 'Admin driver profiles fetched', { profiles });
  } catch (err) {
    return serverError(res, err, 'Admin get driver profiles failed');
  }
};

exports.adminCreateDriverProfile = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const code = String(req.body.code || '').trim().toUpperCase();

    if (!name) return errorResponse(res, 400, 'Driver name required');

    const driverKey = makeDriverKey(req.body.driverKey || name, code);

    const profile = await FanDriverProfile.findOneAndUpdate(
      { driverKey },
      {
        driverKey,
        code,
        name,
        team: String(req.body.team || '').trim(),
        country: String(req.body.country || '').trim(),
        flagEmoji: String(req.body.flagEmoji || '').trim(),
        image: String(req.body.image || '').trim(),
        isActive: req.body.isActive !== false
      },
      { new: true, upsert: true, runValidators: true }
    );

    return successResponse(res, 201, 'Driver profile saved', { profile });
  } catch (err) {
    return serverError(res, err, 'Create driver profile failed');
  }
};

exports.adminUpdateDriverProfile = async (req, res) => {
  try {
    const allowed = ['code','name','team','country','flagEmoji','image','isActive'];
    const payload = {};

    allowed.forEach(key => {
      if (req.body[key] !== undefined) payload[key] = req.body[key];
    });

    if (payload.code) payload.code = String(payload.code).trim().toUpperCase();

    const profile = await FanDriverProfile.findByIdAndUpdate(
      req.params.id,
      payload,
      { new: true, runValidators: true }
    );

    if (!profile) return errorResponse(res, 404, 'Driver profile not found');

    return successResponse(res, 200, 'Driver profile updated', { profile });
  } catch (err) {
    return serverError(res, err, 'Update driver profile failed');
  }
};

exports.adminDeleteDriverProfile = async (req, res) => {
  try {
    const profile = await FanDriverProfile.findByIdAndDelete(req.params.id);
    if (!profile) return errorResponse(res, 404, 'Driver profile not found');
    return successResponse(res, 200, 'Driver profile deleted');
  } catch (err) {
    return serverError(res, err, 'Delete driver profile failed');
  }
};
