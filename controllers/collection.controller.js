const FanPoints = require('../models/FanPoints');
const User = require('../models/User');
const UserCollectible = require('../models/UserCollectible');
const Order = require('../models/Order');
const { getIO } = require('../config/socket');

const CATALOG = [
  {
    code: 'grid-rookie', title: 'Grid Rookie', icon: '🏁', rarity: 'Common', category: 'fan-points',
    description: 'Earn your first 20 PADDOX Fan Points.',
    target: 20,
    unlocked: ({ fanPoints }) => fanPoints >= 20,
    progress: ({ fanPoints }) => Math.min(fanPoints, 20),
    progressLabel: ({ fanPoints }) => `${Math.min(fanPoints, 20)} / 20 Fan Points`
  },
  {
    code: 'century-club', title: 'Century Club', icon: '💯', rarity: 'Rare', category: 'fan-points',
    description: 'Reach 100 PADDOX Fan Points.',
    target: 100,
    unlocked: ({ fanPoints }) => fanPoints >= 100,
    progress: ({ fanPoints }) => Math.min(fanPoints, 100),
    progressLabel: ({ fanPoints }) => `${Math.min(fanPoints, 100)} / 100 Fan Points`
  },
  {
    code: 'poll-strategist', title: 'Poll Strategist', icon: '📊', rarity: 'Common', category: 'community',
    description: 'Cast your first live Fan Hub poll vote.',
    target: 1,
    unlocked: ({ counts }) => (counts.poll_vote || 0) >= 1,
    progress: ({ counts }) => Math.min(counts.poll_vote || 0, 1),
    progressLabel: ({ counts }) => `${Math.min(counts.poll_vote || 0, 1)} / 1 Poll Vote`,
    sourceAction: 'poll_vote'
  },
  {
    code: 'trivia-ace', title: 'Trivia Ace', icon: '🧠', rarity: 'Rare', category: 'community',
    description: 'Answer a PADDOX trivia question correctly.',
    target: 1,
    unlocked: ({ counts }) => (counts.trivia || 0) >= 1,
    progress: ({ counts }) => Math.min(counts.trivia || 0, 1),
    progressLabel: ({ counts }) => `${Math.min(counts.trivia || 0, 1)} / 1 Correct Answer`,
    sourceAction: 'trivia'
  },
  {
    code: 'grid-voice', title: 'Grid Voice', icon: '🎙️', rarity: 'Rare', category: 'community',
    description: 'Publish your first Fan Hub community post.',
    target: 1,
    unlocked: ({ counts }) => (counts.fan_post || 0) >= 1,
    progress: ({ counts }) => Math.min(counts.fan_post || 0, 1),
    progressLabel: ({ counts }) => `${Math.min(counts.fan_post || 0, 1)} / 1 Fan Post`,
    sourceAction: 'fan_post'
  },
  {
    code: 'digital-hunter', title: 'Digital Hunter', icon: '🖼️', rarity: 'Epic', category: 'digital',
    description: 'Download your first PADDOX digital asset.',
    target: 1,
    unlocked: ({ counts }) => (counts.download || 0) >= 1,
    progress: ({ counts }) => Math.min(counts.download || 0, 1),
    progressLabel: ({ counts }) => `${Math.min(counts.download || 0, 1)} / 1 Download`,
    sourceAction: 'download'
  },
  {
    code: 'garage-owner', title: 'Garage Owner', icon: '🛍️', rarity: 'Epic', category: 'commerce',
    description: 'Complete your first paid PADDOX order.',
    target: 1,
    unlocked: ({ paidOrders }) => paidOrders >= 1,
    progress: ({ paidOrders }) => Math.min(paidOrders, 1),
    progressLabel: ({ paidOrders }) => `${Math.min(paidOrders, 1)} / 1 Paid Order`,
    sourceAction: 'purchase'
  },
  {
    code: 'pro-grid', title: 'Pro Grid', icon: '🏆', rarity: 'Legendary', category: 'fan-points',
    description: 'Reach 1,000 PADDOX Fan Points and enter the Pro Fan tier.',
    target: 1000,
    unlocked: ({ fanPoints }) => fanPoints >= 1000,
    progress: ({ fanPoints }) => Math.min(fanPoints, 1000),
    progressLabel: ({ fanPoints }) => `${Math.min(fanPoints, 1000)} / 1,000 Fan Points`
  }
];

function publicCollectible(item) {
  return {
    id: String(item._id || ''),
    code: item.code,
    title: item.title,
    description: item.description,
    category: item.category,
    rarity: item.rarity,
    icon: item.icon,
    sourceAction: item.sourceAction,
    sourceMeta: item.sourceMeta || {},
    unlockedAt: item.unlockedAt,
    sharedCount: Number(item.sharedCount || 0)
  };
}

async function buildActivityState(userId) {
  const [user, logs, paidOrders] = await Promise.all([
    User.findById(userId).select('fanPoints fanTier updatedAt').lean(),
    FanPoints.find({ user: userId }).sort({ createdAt: 1 }).lean(),
    Order.countDocuments({
      user: userId,
      'payment.status': 'paid',
      status: { $ne: 'cancelled' }
    })
  ]);

  if (!user) throw new Error('User not found');

  const counts = {};
  const firstAction = {};
  const latestAction = {};
  logs.forEach(log => {
    const action = String(log.action || '');
    if (!action) return;
    counts[action] = (counts[action] || 0) + 1;
    if (!firstAction[action]) firstAction[action] = log;
    latestAction[action] = log;
  });

  return {
    fanPoints: Number(user.fanPoints || 0),
    fanTier: user.fanTier || 'Regular',
    userUpdatedAt: user.updatedAt,
    counts,
    firstAction,
    latestAction,
    paidOrders: Number(paidOrders || 0)
  };
}

async function syncUserCollectibles(userId) {
  const state = await buildActivityState(userId);
  const existing = await UserCollectible.find({ user: userId }).lean();
  const existingCodes = new Set(existing.map(item => item.code));
  const newlyUnlocked = [];

  for (const entry of CATALOG) {
    if (!entry.unlocked(state) || existingCodes.has(entry.code)) continue;

    const sourceLog = entry.sourceAction ? state.firstAction[entry.sourceAction] : null;
    const unlockedAt = sourceLog?.createdAt || state.userUpdatedAt || new Date();
    const sourceMeta = sourceLog?.meta || {
      fanPoints: state.fanPoints,
      paidOrders: state.paidOrders
    };

    try {
      const created = await UserCollectible.create({
        user: userId,
        code: entry.code,
        title: entry.title,
        description: entry.description,
        category: entry.category,
        rarity: entry.rarity,
        icon: entry.icon,
        sourceAction: entry.sourceAction || '',
        sourceMeta,
        unlockedAt
      });
      newlyUnlocked.push(created);
      existingCodes.add(entry.code);
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }
  }

  if (newlyUnlocked.length) {
    try {
      const io = getIO();
      newlyUnlocked.forEach(item => {
        io.to(`user:${userId}`).emit('collection:unlocked', publicCollectible(item));
      });
    } catch (_) {}
  }

  const earned = await UserCollectible.find({ user: userId })
    .sort({ unlockedAt: -1, createdAt: -1 })
    .lean();

  const earnedCodes = new Set(earned.map(item => item.code));
  const locked = CATALOG
    .filter(entry => !earnedCodes.has(entry.code))
    .map(entry => {
      const value = Number(entry.progress(state) || 0);
      const target = Number(entry.target || 1);
      return {
        code: entry.code,
        title: entry.title,
        description: entry.description,
        category: entry.category,
        rarity: entry.rarity,
        icon: entry.icon,
        progress: value,
        target,
        progressPercent: Math.max(0, Math.min(100, Math.round((value / Math.max(1, target)) * 100))),
        progressLabel: entry.progressLabel(state)
      };
    })
    .sort((a, b) => b.progressPercent - a.progressPercent);

  return { state, earned, locked, newlyUnlocked };
}

exports.getMyCollection = async (req, res, next) => {
  try {
    const { state, earned, locked, newlyUnlocked } = await syncUserCollectibles(req.user._id);
    const items = earned.map(publicCollectible);
    const shared = items.reduce((sum, item) => sum + Number(item.sharedCount || 0), 0);

    return res.json({
      success: true,
      data: {
        summary: {
          earned: items.length,
          latest: items[0]?.title || '—',
          shared,
          fanPoints: state.fanPoints,
          fanTier: state.fanTier,
          newlyUnlocked: newlyUnlocked.length
        },
        items,
        nextUnlocks: locked.slice(0, 4),
        syncedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.shareCollectible = async (req, res, next) => {
  try {
    await syncUserCollectibles(req.user._id);
    const collectible = await UserCollectible.findOneAndUpdate(
      { user: req.user._id, code: req.params.code },
      { $inc: { sharedCount: 1 } },
      { new: true }
    );

    if (!collectible) {
      return res.status(404).json({ success: false, message: 'Collectible not unlocked yet.' });
    }

    const payload = publicCollectible(collectible);
    try { getIO().to(`user:${req.user._id}`).emit('collection:shared', payload); } catch (_) {}

    return res.json({ success: true, data: { collectible: payload } });
  } catch (err) {
    next(err);
  }
};

exports.syncUserCollectibles = syncUserCollectibles;
