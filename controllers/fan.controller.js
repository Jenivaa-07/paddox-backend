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
const HomeMarqueeLogo = require('../models/HomeMarqueeLogo');
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

function publicFanPost(post, viewerId = null) {
  const obj = post?.toObject ? post.toObject() : (post || {});
  const likedBy = Array.isArray(obj.likedBy) ? obj.likedBy : [];
  const legacyLikes = Number(obj.likes || 0);
  const likesCount = likedBy.length || legacyLikes || 0;
  const viewer = viewerId ? String(viewerId) : '';

  const comments = Array.isArray(obj.comments) ? obj.comments : [];
  const cleanComments = comments
    .slice(-8)
    .map(comment => ({
      _id: comment._id,
      text: comment.text,
      createdAt: comment.createdAt,
      user: comment.user
    }));

  return {
    ...obj,
    likesCount,
    commentsCount: comments.length,
    likedByCurrentUser: viewer
      ? likedBy.some(id => String(id?._id || id) === viewer)
      : false,
    comments: cleanComments
  };
}


function pollResultPayload(poll) {
  const obj = poll?.toObject ? poll.toObject() : (poll || {});
  const options = Array.isArray(obj.options) ? obj.options : [];
  const totalVotes = options.reduce((sum, option) => sum + Number(option.votes || 0), 0);

  return {
    poll: {
      ...obj,
      options: options.map(option => ({
        ...option,
        percentage: totalVotes > 0
          ? Math.round((Number(option.votes || 0) / totalVotes) * 100)
          : 0
      }))
    },
    options: options.map(option => ({
      ...option,
      percentage: totalVotes > 0
        ? Math.round((Number(option.votes || 0) / totalVotes) * 100)
        : 0
    })),
    totalVotes
  };
}

async function getActivePoll() {
  return Poll.findOne({ isActive:true }).sort('-createdAt');
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
    const poll = await getActivePoll();

    if (!poll) {
      return errorResponse(res, 404, 'No active poll right now');
    }

    return successResponse(
      res,
      200,
      'Poll fetched',
      pollResultPayload(poll)
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
      return res.status(409).json({
        success: false,
        message: 'You have already voted in this poll',
        data: {
          alreadyVoted: true,
          ...pollResultPayload(poll)
        }
      });
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

    const result = pollResultPayload(poll);

    try {
      getIO().emit('poll:vote-update', {
        pollId,
        options: result.options,
        totalVotes: result.totalVotes
      });
    } catch {}

    return successResponse(
      res,
      200,
      'Vote recorded! +50 Fan Points',
      result
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
        .limit(Math.min(Number(limit) || 20, 50))
        .populate('user','firstName lastName avatar')
        .populate('comments.user','firstName lastName avatar');

    return successResponse(
      res,
      200,
      'Fan feed fetched',
      {
        posts: posts.map(post => publicFanPost(post, req.user?._id))
      }
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

    const publicPostData = publicFanPost(post, req.user._id);

    try {
      getIO().emit('fan:new-post', {
        post: publicPostData,
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
      { post: publicPostData }
    );

  } catch (err) {
    return serverError(res, err, 'Post fan feed failed');
  }
};

/* ── LIKE / UNLIKE FAN FEED POST ── */
exports.toggleFeedLike = async (req, res) => {
  try {
    const { id } = req.params;

    const post =
      await FanPost.findOne({
        _id: id,
        isApproved: true,
        isFlagged: false
      });

    if (!post) {
      return errorResponse(res, 404, 'Fan post not found');
    }

    if (!Array.isArray(post.likedBy)) post.likedBy = [];

    const userId = String(req.user._id);
    const alreadyLiked = post.likedBy.some(v => String(v) === userId);

    if (alreadyLiked) {
      post.likedBy = post.likedBy.filter(v => String(v) !== userId);
    } else {
      post.likedBy.push(req.user._id);
    }

    post.likes = post.likedBy.length;
    await post.save();

    await post.populate('user','firstName lastName avatar');
    await post.populate('comments.user','firstName lastName avatar');

    const publicPostData = publicFanPost(post, req.user._id);

    try {
      getIO().emit('fan:post-like', {
        postId: post._id,
        likesCount: publicPostData.likesCount,
        liked: !alreadyLiked
      });
    } catch {}

    return successResponse(
      res,
      200,
      alreadyLiked ? 'Like removed' : 'Post liked',
      { post: publicPostData }
    );

  } catch (err) {
    return serverError(res, err, 'Toggle feed like failed');
  }
};

/* ── COMMENT ON FAN FEED POST ── */
exports.addFeedComment = async (req, res) => {
  try {
    const { id } = req.params;
    const cleanText = String(req.body?.text || '').trim().slice(0, 220);

    if (!cleanText) {
      return errorResponse(res, 400, 'Comment text required');
    }

    const post =
      await FanPost.findOne({
        _id: id,
        isApproved: true,
        isFlagged: false
      });

    if (!post) {
      return errorResponse(res, 404, 'Fan post not found');
    }

    post.comments.push({
      user: req.user._id,
      text: cleanText
    });

    await post.save();

    await post.populate('user','firstName lastName avatar');
    await post.populate('comments.user','firstName lastName avatar');

    await FanPoints.create({
      user: req.user._id,
      action: 'fan_comment',
      points: 5,
      meta: { postId: post._id }
    });

    await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { fanPoints: 5 } }
    );

    const publicPostData = publicFanPost(post, req.user._id);

    try {
      getIO().emit('fan:post-comment', {
        postId: post._id,
        post: publicPostData
      });
    } catch {}

    return successResponse(
      res,
      201,
      'Comment added! +5 Fan Points',
      { post: publicPostData }
    );

  } catch (err) {
    return serverError(res, err, 'Add feed comment failed');
  }
};




/* ── ADMIN POLL HELPERS ── */
function publicPoll(poll) {
  const obj = poll?.toObject ? poll.toObject() : (poll || {});
  const options = Array.isArray(obj.options) ? obj.options : [];
  const totalVotes = options.reduce((sum, o) => sum + Number(o.votes || 0), 0);
  return {
    ...obj,
    totalVotes,
    options: options.map(o => ({
      ...o,
      percentage: totalVotes > 0 ? Math.round((Number(o.votes || 0) / totalVotes) * 100) : 0
    }))
  };
}

function normalizePollOptions(options = [], resetVotes = false) {
  const list = Array.isArray(options) ? options : [];

  return list
    .map(item => {
      const src = typeof item === 'string' ? { label:item } : (item || {});
      const label = src.label || src.text || '';
      const votes = resetVotes ? 0 : Number(src.votes || 0);

      return {
        label    : String(label || '').trim(),
        votes    : Number.isFinite(votes) ? votes : 0,
        logo     : String(src.logo || src.teamLogo || src.image || '').trim(),
        teamName : String(src.teamName || src.team || src.logoName || '').trim(),
        teamColor: String(src.teamColor || src.color || '#e8002d').trim(),
        logoKey  : String(src.logoKey || src.key || src.slug || '').trim()
      };
    })
    .filter(item => item.label)
    .slice(0, 5);
}

async function deactivateOtherPolls(activeId) {
  if (!activeId) return;
  await Poll.updateMany({ _id: { $ne: activeId } }, { $set: { isActive: false } });
}

/* ── ADMIN GET ALL POLLS ── */
exports.adminGetPolls = async (req, res) => {
  try {
    const polls = await Poll.find()
      .sort({ isActive: -1, createdAt: -1 })
      .limit(200);

    return successResponse(res, 200, 'Admin polls fetched', {
      polls: polls.map(publicPoll)
    });
  } catch (err) {
    return serverError(res, err, 'Admin get polls failed');
  }
};

/* ── ADMIN CREATE POLL ── */
exports.adminCreatePoll = async (req, res) => {
  try {
    const question = String(req.body.question || '').trim();
    const options = normalizePollOptions(req.body.options, true);
    const isActive = req.body.isActive !== false;

    if (!question) return errorResponse(res, 400, 'Poll question required');
    if (options.length < 2) return errorResponse(res, 400, 'At least 2 poll options required');

    const poll = await Poll.create({
      question,
      options,
      voters: [],
      isActive,
      endsAt: req.body.endsAt || undefined,
      createdBy: req.user?._id
    });

    if (isActive) await deactivateOtherPolls(poll._id);

    try { getIO().emit('poll:changed', { poll: publicPoll(poll) }); } catch {}

    return successResponse(res, 201, 'Poll created', {
      poll: publicPoll(poll)
    });
  } catch (err) {
    return serverError(res, err, 'Create poll failed');
  }
};

/* ── ADMIN UPDATE POLL ── */
exports.adminUpdatePoll = async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);
    if (!poll) return errorResponse(res, 404, 'Poll not found');

    if (req.body.question !== undefined) {
      const question = String(req.body.question || '').trim();
      if (!question) return errorResponse(res, 400, 'Poll question required');
      poll.question = question;
    }

    if (req.body.options !== undefined) {
      const resetVotes = !!req.body.resetVotes;
      const normalized = normalizePollOptions(req.body.options, resetVotes);
      if (normalized.length < 2) return errorResponse(res, 400, 'At least 2 poll options required');
      poll.options = normalized;
      if (resetVotes) poll.voters = [];
    } else if (req.body.resetVotes) {
      poll.options.forEach(option => { option.votes = 0; });
      poll.voters = [];
    }

    if (req.body.isActive !== undefined) poll.isActive = !!req.body.isActive;
    if (req.body.endsAt !== undefined) poll.endsAt = req.body.endsAt || undefined;

    await poll.save();
    if (poll.isActive) await deactivateOtherPolls(poll._id);

    try {
      const updated = publicPoll(poll);
      getIO().emit('poll:changed', { poll: updated });
      getIO().emit('poll:vote-update', {
        pollId: String(poll._id),
        options: updated.options,
        totalVotes: updated.totalVotes
      });
    } catch {}

    return successResponse(res, 200, 'Poll updated', {
      poll: publicPoll(poll)
    });
  } catch (err) {
    return serverError(res, err, 'Update poll failed');
  }
};

/* ── ADMIN SET ACTIVE POLL ── */
exports.adminSetActivePoll = async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);
    if (!poll) return errorResponse(res, 404, 'Poll not found');

    poll.isActive = req.body.isActive !== false;
    await poll.save();

    if (poll.isActive) await deactivateOtherPolls(poll._id);

    try { getIO().emit('poll:changed', { poll: publicPoll(poll) }); } catch {}

    return successResponse(res, 200, 'Active poll updated', {
      poll: publicPoll(poll)
    });
  } catch (err) {
    return serverError(res, err, 'Set active poll failed');
  }
};

/* ── ADMIN DELETE POLL ── */
exports.adminDeletePoll = async (req, res) => {
  try {
    const poll = await Poll.findByIdAndDelete(req.params.id);
    if (!poll) return errorResponse(res, 404, 'Poll not found');

    try { getIO().emit('poll:changed', { deletedId: req.params.id }); } catch {}

    return successResponse(res, 200, 'Poll deleted', {
      deletedId: req.params.id
    });
  } catch (err) {
    return serverError(res, err, 'Delete poll failed');
  }
};

/* ── DEFAULT QUOTES SEED ── */
async function ensureDefaultQuotes() {
  const count = await Quote.countDocuments();

  if (count > 0) return;

  await Quote.insertMany([
    { text:'When you are fitted in a racing car and you race to win, second or third place is not enough.', driver:'Ayrton Senna', team:'McLaren / Lotus / Williams', era:'legend', category:'champions', avatar:'', isFeatured:true },
    { text:'The moment money becomes your motivation, you are immediately not as good as someone who is stimulated by passion.', driver:'Sebastian Vettel', team:'Red Bull / Ferrari / Aston Martin', era:'legend', category:'motivation', avatar:'', isFeatured:true },
    { text:'I do not aspire to be like other drivers. I aspire to be unique in my own way.', driver:'Lewis Hamilton', team:'Mercedes / Ferrari', era:'current', category:'champions', avatar:'', isFeatured:true },
    { text:'I always believe I can improve. That is the mindset you need in Formula 1.', driver:'Max Verstappen', team:'Oracle Red Bull Racing', era:'current', category:'current-grid', avatar:'', isFeatured:true },
    { text:'Monaco is special. You need confidence, precision and a little bit of magic.', driver:'Charles Leclerc', team:'Scuderia Ferrari', era:'current', category:'race-weekend', avatar:'' },
    { text:'You cannot always control the result, but you can control how much you push.', driver:'Lando Norris', team:'McLaren F1 Team', era:'current', category:'motivation', avatar:'' },
    { text:'Experience teaches you where to take risk and where to be patient.', driver:'Fernando Alonso', team:'Aston Martin F1', era:'current', category:'racecraft', avatar:'' },
    { text:'To finish first, first you have to finish.', driver:'Juan Manuel Fangio', team:'F1 Legend', era:'legend', category:'historic', avatar:'' },
    { text:'I was always racing for myself, not against anyone else.', driver:'Niki Lauda', team:'Ferrari / McLaren', era:'legend', category:'historic', avatar:'' },
    { text:'Racing is life. Everything before or after is just waiting.', driver:'Steve McQueen', team:'Racing Icon', era:'legend', category:'historic', avatar:'' },
    { text:'Every lap is a new chance to understand the car better.', driver:'Oscar Piastri', team:'McLaren F1 Team', era:'current', category:'current-grid', avatar:'' },
    { text:'Pressure is part of racing. You learn to turn it into focus.', driver:'George Russell', team:'Mercedes-AMG Petronas', era:'current', category:'motivation', avatar:'' },
    { text:'The best races are won before the lights go out — in preparation.', driver:'Carlos Sainz', team:'Williams / Ferrari', era:'current', category:'racecraft', avatar:'' },
    { text:'In Formula 1, small details become big differences.', driver:'Kimi Räikkönen', team:'Ferrari / McLaren / Sauber', era:'legend', category:'racecraft', avatar:'' },
    { text:'Sometimes you need to trust the car, sometimes the car needs to trust you.', driver:'Daniel Ricciardo', team:'F1 Driver', era:'legend', category:'motivation', avatar:'' }
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


/* ── HOME MARQUEE LOGOS ── */
function homeLogoSlug(name = '') {
  return String(name || 'logo')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'logo';
}

function publicHomeLogo(item) {
  const obj = item.toObject ? item.toObject() : item;
  return {
    _id: obj._id,
    name: obj.name,
    slug: obj.slug,
    image: obj.image,
    color: obj.color,
    order: obj.order,
    isActive: obj.isActive
  };
}

exports.getHomeMarqueeLogos = async (req, res) => {
  try {
    const logos = await HomeMarqueeLogo.find({ isActive: true })
      .sort({ order: 1, createdAt: 1 })
      .limit(40);

    return successResponse(res, 200, 'Home marquee logos fetched', {
      logos: logos.map(publicHomeLogo)
    });
  } catch (err) {
    return serverError(res, err, 'Get home marquee logos failed');
  }
};

exports.adminGetHomeMarqueeLogos = async (req, res) => {
  try {
    const logos = await HomeMarqueeLogo.find({})
      .sort({ order: 1, createdAt: 1 })
      .limit(80);

    return successResponse(res, 200, 'Admin home marquee logos fetched', {
      logos: logos.map(publicHomeLogo)
    });
  } catch (err) {
    return serverError(res, err, 'Admin get home marquee logos failed');
  }
};

exports.adminCreateHomeMarqueeLogo = async (req, res) => {
  try {
    const { name, image, color = '#e8002d', order = 0, isActive = true } = req.body || {};

    if (!name || !String(name).trim()) {
      return errorResponse(res, 400, 'Logo name required');
    }

    if (!image || !String(image).startsWith('data:image/')) {
      return errorResponse(res, 400, 'Cropped logo image required');
    }

    const logo = await HomeMarqueeLogo.create({
      name: String(name).trim(),
      slug: homeLogoSlug(name),
      image,
      color: String(color || '#e8002d').trim(),
      order: Number(order || 0),
      isActive: isActive !== false,
      createdBy: req.user?._id
    });

    return successResponse(res, 201, 'Home marquee logo created', {
      logo: publicHomeLogo(logo)
    });
  } catch (err) {
    return serverError(res, err, 'Create home marquee logo failed');
  }
};

exports.adminUpdateHomeMarqueeLogo = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, image, color, order, isActive } = req.body || {};

    const update = {};
    if (name !== undefined) {
      update.name = String(name).trim();
      update.slug = homeLogoSlug(name);
    }
    if (image !== undefined) {
      if (!String(image).startsWith('data:image/')) {
        return errorResponse(res, 400, 'Valid cropped logo image required');
      }
      update.image = image;
    }
    if (color !== undefined) update.color = String(color || '#e8002d').trim();
    if (order !== undefined) update.order = Number(order || 0);
    if (isActive !== undefined) update.isActive = !!isActive;

    const logo = await HomeMarqueeLogo.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true
    });

    if (!logo) return errorResponse(res, 404, 'Marquee logo not found');

    return successResponse(res, 200, 'Home marquee logo updated', {
      logo: publicHomeLogo(logo)
    });
  } catch (err) {
    return serverError(res, err, 'Update home marquee logo failed');
  }
};

exports.adminDeleteHomeMarqueeLogo = async (req, res) => {
  try {
    const logo = await HomeMarqueeLogo.findByIdAndDelete(req.params.id);
    if (!logo) return errorResponse(res, 404, 'Marquee logo not found');

    return successResponse(res, 200, 'Home marquee logo deleted', {
      deletedId: req.params.id
    });
  } catch (err) {
    return serverError(res, err, 'Delete home marquee logo failed');
  }
};
