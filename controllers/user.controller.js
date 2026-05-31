/* ============================================================
   FILE: controllers/user.controller.js
   PADDOX — REALTIME USER PROFILE CONTROLLER
   ============================================================ */
const User       = require('../models/User');
const FanPoints  = require('../models/FanPoints');
const DigitalAsset = require('../models/DigitalAsset');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { cloudinary } = require('../config/cloudinary');

function serverError(res, err, label = 'Server error') {
  console.error(label, err);
  return res.status(500).json({
    success: false,
    message: err.message || label
  });
}

function publicUser(user) {
  if (!user) return null;

  const obj = user.toObject ? user.toObject() : user;
  delete obj.password;
  delete obj.refreshToken;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpire;
  return obj;
}

/* ── GET PROFILE ── */
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -refreshToken');

    if (!user) {
      return errorResponse(res, 404, 'User not found');
    }

    return successResponse(res, 200, 'Profile fetched', { user: publicUser(user) });

  } catch (err) {
    return serverError(res, err, 'Get profile failed');
  }
};

/* ── UPDATE PROFILE ── */
exports.updateProfile = async (req, res) => {
  try {
    const allowed = {};

    ['firstName', 'lastName', 'phone', 'dateOfBirth'].forEach(key => {
      if (req.body[key] !== undefined) allowed[key] = req.body[key];
    });

    if (req.body.address !== undefined) {
      allowed.address = {
        line1: req.body.address.line1 || '',
        line2: req.body.address.line2 || '',
        city: req.body.address.city || '',
        state: req.body.address.state || '',
        pincode: req.body.address.pincode || '',
        country: req.body.address.country || 'India'
      };
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      allowed,
      {
        new: true,
        runValidators: true
      }
    ).select('-password -refreshToken');

    if (!user) {
      return errorResponse(res, 404, 'User not found');
    }

    return successResponse(res, 200, 'Profile updated', { user: publicUser(user) });

  } catch (err) {
    return serverError(res, err, 'Update profile failed');
  }
};

/* ── UPDATE AVATAR ── */
exports.updateAvatar = async (req, res) => {
  try {
    if (!req.file) return errorResponse(res, 400, 'No image uploaded');

    const user = await User.findById(req.user._id);

    if (!user) {
      return errorResponse(res, 404, 'User not found');
    }

    if (user.avatar?.publicId && cloudinary) {
      await cloudinary.uploader.destroy(user.avatar.publicId);
    }

    user.avatar = {
      url: req.file.path,
      publicId: req.file.filename
    };

    await user.save({ validateBeforeSave:false });

    return successResponse(res, 200, 'Avatar updated', { avatar: user.avatar });

  } catch (err) {
    return serverError(res, err, 'Update avatar failed');
  }
};

/* ── UPDATE PREFERENCES ── */
exports.updatePreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return errorResponse(res, 404, 'User not found');
    }

    user.preferences = {
      ...user.preferences,
      favouriteTeam: req.body.favouriteTeam ?? user.preferences?.favouriteTeam ?? '',
      favouriteDriver: req.body.favouriteDriver ?? user.preferences?.favouriteDriver ?? '',
      newsletter: req.body.newsletter ?? user.preferences?.newsletter ?? true
    };

    await user.save({ validateBeforeSave:false });

    return successResponse(res, 200, 'Preferences updated', {
      preferences: user.preferences,
      user: publicUser(user)
    });

  } catch (err) {
    return serverError(res, err, 'Update preferences failed');
  }
};

/* ── UPDATE NOTIFICATIONS ── */
exports.updateNotifications = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return errorResponse(res, 404, 'User not found');
    }

    user.notifications = {
      ...user.notifications,
      ...req.body
    };

    await user.save({ validateBeforeSave:false });

    return successResponse(res, 200, 'Notification settings updated', {
      notifications: user.notifications
    });

  } catch (err) {
    return serverError(res, err, 'Update notifications failed');
  }
};

/* ── GET FAN POINTS ── */
exports.getFanPoints = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('fanPoints fanTier');
    const history = await FanPoints.find({ user: req.user._id }).sort('-createdAt').limit(20);

    return successResponse(res, 200, 'Fan points fetched', {
      fanPoints: user?.fanPoints || 0,
      fanTier: user?.fanTier || 'Regular',
      history
    });

  } catch (err) {
    return serverError(res, err, 'Get fan points failed');
  }
};

/* ── GET DOWNLOADS ── */
exports.getDownloads = async (req, res) => {
  try {
    const history = await FanPoints.find({
      user: req.user._id,
      action: 'download',
      'meta.assetId': { $exists: true }
    })
      .sort('-createdAt')
      .limit(100)
      .lean();

    const latestByAsset = new Map();

    history.forEach(item => {
      const assetId = String(item.meta?.assetId || '');

      if (assetId && !latestByAsset.has(assetId)) {
        latestByAsset.set(assetId, item.createdAt);
      }
    });

    const ids = [...latestByAsset.keys()];

    const assets = ids.length
      ? await DigitalAsset.find({
          _id: { $in: ids },
          isActive: true
        }).select('-__v')
      : [];

    const sortedAssets = assets
      .map(asset => {
        const obj = asset.toObject ? asset.toObject() : asset;
        obj.downloadedAt = latestByAsset.get(String(obj._id));
        return obj;
      })
      .sort((a, b) => new Date(b.downloadedAt || 0) - new Date(a.downloadedAt || 0));

    return successResponse(res, 200, 'Downloads fetched', {
      assets: sortedAssets,
      count: sortedAssets.length
    });

  } catch (err) {
    return serverError(res, err, 'Get downloads failed');
  }
};


/* ============================================================
   PHASE A4.7C.4 — BREVO EMAIL 2FA + SESSION SYNC
   ============================================================ */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { sendEmail } = require('../config/resend');

function codeHash(code = '') {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function sixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getBrowserName(ua = '') {
  const s = String(ua || '');
  if (/Edg\//i.test(s)) return 'Edge';
  if (/Chrome\//i.test(s) && !/Edg\//i.test(s)) return 'Chrome';
  if (/Safari\//i.test(s) && !/Chrome\//i.test(s)) return 'Safari';
  if (/Firefox\//i.test(s)) return 'Firefox';
  return 'Browser';
}

function getDeviceName(ua = '') {
  const s = String(ua || '');
  if (/Mobi|Android|iPhone/i.test(s)) return 'Mobile';
  if (/Tablet|iPad/i.test(s)) return 'Tablet';
  return 'Desktop';
}

function safeUserForSecurity(user) {
  const obj = publicUser(user);
  if (!obj.security) obj.security = { twoFactor: { enabled:false }, sessions: [] };
  obj.security.twoFactor = {
    enabled: !!obj.security?.twoFactor?.enabled,
    enabledAt: obj.security?.twoFactor?.enabledAt || null,
    lastSentAt: obj.security?.twoFactor?.lastSentAt || null
  };
  return obj;
}

exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword = '', newPassword = '' } = req.body;
    if (!currentPassword || !newPassword) return errorResponse(res, 400, 'Current and new password are required');
    if (String(newPassword).length < 8) return errorResponse(res, 400, 'New password must be at least 8 characters');

    const user = await User.findById(req.user._id).select('+password');
    if (!user) return errorResponse(res, 404, 'User not found');

    const ok = await user.matchPassword(currentPassword);
    if (!ok) return errorResponse(res, 401, 'Current password is incorrect');

    user.password = newPassword;
    user.refreshToken = '';
    await user.save();

    return successResponse(res, 200, 'Password updated. Please login again.');
  } catch (err) {
    return serverError(res, err, 'Password update failed');
  }
};

exports.sendTwoFactorCode = async (req, res) => {
  try {
    const { currentPassword = '', action = 'enable' } = req.body;
    const pendingAction = String(action || 'enable').toLowerCase() === 'disable' ? 'disable' : 'enable';

    const user = await User.findById(req.user._id).select('+password security email firstName lastName avatar fanPoints fanTier role');
    if (!user) return errorResponse(res, 404, 'User not found');

    const ok = await user.matchPassword(currentPassword);
    if (!ok) return errorResponse(res, 401, 'Current password is incorrect');

    const code = sixDigitCode();
    if (!user.security) user.security = {};
    if (!user.security.twoFactor) user.security.twoFactor = {};
    user.security.twoFactor.codeHash = codeHash(code);
    user.security.twoFactor.codeExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.security.twoFactor.pendingAction = pendingAction;
    user.security.twoFactor.lastSentAt = new Date();
    await user.save({ validateBeforeSave:false });

    await sendEmail(
      user.email,
      `🔐 PADDOX 2FA Verification Code`,
      `<div style="font-family:Arial,sans-serif;background:#080808;color:#fff;padding:28px;border-radius:14px;border:1px solid #222">
        <div style="letter-spacing:5px;color:#e8002d;font-size:12px;font-weight:700">PADDOX SECURITY</div>
        <h2 style="margin:10px 0 8px;font-size:26px">Your verification code</h2>
        <p style="color:#c9c9c9;line-height:1.6">Use this code to ${pendingAction === 'enable' ? 'enable' : 'disable'} two-factor authentication on your PADDOX account.</p>
        <div style="font-size:34px;font-weight:900;letter-spacing:8px;background:#141414;border:1px solid #333;padding:16px 20px;display:inline-block;margin:16px 0;color:#fff">${code}</div>
        <p style="color:#777;font-size:12px">This code expires in 10 minutes. If you did not request this, ignore this email.</p>
      </div>`
    );

    console.log('PADDOX Brevo 2FA settings code sent:', user.email);
    return successResponse(res, 200, `Verification code sent to ${user.email}`, { emailSent:true, emailTo:user.email });
  } catch (err) {
    console.error('PADDOX 2FA send failed:', err.message);
    return serverError(res, err, '2FA send failed');
  }
};


/* ── LOGIN 2FA OTP SEND ──
   Public helper used only after /auth/login returns a temporary twoFactorToken.
   It generates and emails the login verification code through Brevo, then stores
   the hash on the user for /auth/2fa/verify to validate.
*/
function verifyTempTwoFactorToken(token = '') {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) return null;

  const possibleSecrets = [
    process.env.JWT_SECRET,
    process.env.JWT_ACCESS_SECRET,
    process.env.ACCESS_TOKEN_SECRET,
    process.env.TWO_FACTOR_JWT_SECRET,
    process.env.TWO_FACTOR_SECRET,
  ].filter(Boolean);

  for (const secret of possibleSecrets) {
    try {
      return jwt.verify(cleanToken, secret);
    } catch (err) {
      // Try next configured secret.
    }
  }

  try {
    return jwt.decode(cleanToken);
  } catch (err) {
    return null;
  }
}

function getUserIdFromTwoFactorPayload(payload = {}) {
  return (
    payload.id ||
    payload._id ||
    payload.userId ||
    payload.user ||
    payload.sub ||
    payload.uid ||
    ''
  );
}

exports.sendLoginTwoFactorCode = async (req, res) => {
  try {
    const { twoFactorToken = '' } = req.body || {};
    const payload = verifyTempTwoFactorToken(twoFactorToken);
    const userId = getUserIdFromTwoFactorPayload(payload || {});

    if (!payload || !userId) {
      return errorResponse(res, 401, 'Invalid or expired 2FA login session. Please login again.');
    }

    const user = await User.findById(userId).select('security email firstName lastName role');
    if (!user) return errorResponse(res, 404, 'User not found');

    if (!user.security?.twoFactor?.enabled) {
      return errorResponse(res, 400, 'Two-factor authentication is not enabled for this account');
    }

    const now = Date.now();
    const lastSentAt = user.security.twoFactor.lastSentAt
      ? new Date(user.security.twoFactor.lastSentAt).getTime()
      : 0;

    if (lastSentAt && now - lastSentAt < 20 * 1000) {
      return successResponse(res, 200, `Verification code already sent to ${user.email}`, {
        emailSent: true,
        emailTo: user.email,
        cooldown: true
      });
    }

    const code = sixDigitCode();
    if (!user.security) user.security = {};
    if (!user.security.twoFactor) user.security.twoFactor = {};

    user.security.twoFactor.codeHash = codeHash(code);
    user.security.twoFactor.codeExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.security.twoFactor.pendingAction = 'login';
    user.security.twoFactor.lastSentAt = new Date();
    await user.save({ validateBeforeSave:false });

    const emailResult = await sendEmail(
      user.email,
      `🔐 PADDOX Login Verification Code`,
      `<div style="font-family:Arial,sans-serif;background:#080808;color:#fff;padding:28px;border-radius:14px;border:1px solid #222">
        <div style="letter-spacing:5px;color:#e8002d;font-size:12px;font-weight:700">PADDOX SECURITY CHECK</div>
        <h2 style="margin:10px 0 8px;font-size:26px">Your login verification code</h2>
        <p style="color:#c9c9c9;line-height:1.6">Use this code to complete your PADDOX login.</p>
        <div style="font-size:34px;font-weight:900;letter-spacing:8px;background:#141414;border:1px solid #333;padding:16px 20px;display:inline-block;margin:16px 0;color:#fff">${code}</div>
        <p style="color:#777;font-size:12px">This code expires in 10 minutes. If this was not you, change your password immediately.</p>
      </div>`
    );

    if (emailResult && emailResult.success === false) {
      return errorResponse(res, 500, emailResult.message || 'Could not send login verification email');
    }

    console.log('PADDOX Brevo login 2FA code sent:', user.email);
    return successResponse(res, 200, `Verification code sent to ${user.email}`, {
      emailSent: true,
      emailTo: user.email
    });
  } catch (err) {
    console.error('PADDOX login 2FA send failed:', err.message);
    return serverError(res, err, 'Login 2FA send failed');
  }
};

exports.verifyTwoFactorCode = async (req, res) => {
  try {
    const { code = '' } = req.body;
    if (!/^\d{6}$/.test(String(code))) return errorResponse(res, 400, 'Enter a valid 6-digit code');

    const user = await User.findById(req.user._id).select('security email firstName lastName avatar fanPoints fanTier role');
    if (!user) return errorResponse(res, 404, 'User not found');

    const twoFactor = user.security?.twoFactor || {};
    if (!twoFactor.codeHash || !twoFactor.codeExpires || new Date(twoFactor.codeExpires).getTime() < Date.now()) {
      return errorResponse(res, 400, 'Verification code expired. Send a new code.');
    }
    if (twoFactor.codeHash !== codeHash(code)) return errorResponse(res, 400, 'Invalid verification code');

    const enable = twoFactor.pendingAction !== 'disable';
    user.security.twoFactor.enabled = enable;
    user.security.twoFactor.enabledAt = enable ? new Date() : null;
    user.security.twoFactor.codeHash = '';
    user.security.twoFactor.codeExpires = null;
    user.security.twoFactor.pendingAction = '';
    await user.save({ validateBeforeSave:false });

    return successResponse(res, 200, enable ? 'Two-factor authentication enabled' : 'Two-factor authentication disabled', {
      user: safeUserForSecurity(user)
    });
  } catch (err) {
    return serverError(res, err, '2FA verify failed');
  }
};

exports.getSessions = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('security');
    if (!user) return errorResponse(res, 404, 'User not found');

    const currentSessionId = req.get('X-Paddox-Session-Id') || '';
    const ua = req.get('user-agent') || '';
    const now = new Date();

    if (!user.security) user.security = {};
    if (!Array.isArray(user.security.sessions)) user.security.sessions = [];

    if (currentSessionId) {
      const existing = user.security.sessions.find(s => s.sessionId === currentSessionId);
      if (existing) {
        existing.lastSeen = now;
        existing.revoked = false;
      } else {
        user.security.sessions.unshift({
          sessionId: currentSessionId,
          browser: getBrowserName(ua),
          device: getDeviceName(ua),
          ip: req.ip || '',
          userAgent: ua,
          lastSeen: now,
          createdAt: now,
          revoked: false
        });
      }
      user.security.sessions = user.security.sessions.slice(0, 8);
      await user.save({ validateBeforeSave:false });
    }

    const activeSessions = (user.security.sessions || []).filter(s => !s.revoked).map(s => ({
      id: s.sessionId,
      sessionId: s.sessionId,
      browser: s.browser || getBrowserName(s.userAgent),
      device: s.device || getDeviceName(s.userAgent),
      ip: s.ip || '',
      lastSeen: s.lastSeen || s.createdAt,
      lastActiveAt: s.lastSeen || s.createdAt,
      createdAt: s.createdAt,
      current: currentSessionId && s.sessionId === currentSessionId
    }));

    return successResponse(res, 200, 'Sessions fetched', {
      sessions: activeSessions,
      count: activeSessions.length,
      currentSessionId
    });
  } catch (err) {
    return serverError(res, err, 'Sessions fetch failed');
  }
};

exports.revokeSession = async (req, res) => {
  try {
    const sessionId = String(req.params.id || '').trim();
    if (!sessionId) return errorResponse(res, 400, 'Session id required');

    const user = await User.findById(req.user._id).select('security');
    if (!user) return errorResponse(res, 404, 'User not found');

    const currentSessionId = req.get('X-Paddox-Session-Id') || '';
    if (sessionId === currentSessionId) return errorResponse(res, 400, 'Current session cannot be revoked here. Use Sign Out.');

    if (!user.security) user.security = {};
    if (!Array.isArray(user.security.sessions)) user.security.sessions = [];
    const session = user.security.sessions.find(s => s.sessionId === sessionId);
    if (session) session.revoked = true;
    await user.save({ validateBeforeSave:false });

    return successResponse(res, 200, 'Session revoked');
  } catch (err) {
    return serverError(res, err, 'Session revoke failed');
  }
};


/* ── ADMIN: DELETE USER PERMANENTLY ── */
exports.deleteUser = exports.deleteUserById = async (req, res) => {
  try {
    const userId = req.params.id;
    const target = await User.findById(userId).select('firstName lastName email role fanPoints');

    if (!target) {
      return errorResponse(res, 404, 'User not found');
    }

    const deletedUser = {
      _id: target._id,
      firstName: target.firstName,
      lastName: target.lastName,
      email: target.email,
      role: target.role,
      fanPoints: target.fanPoints || 0
    };

    try {
      await FanPoints.deleteMany({ user: target._id });
    } catch (historyErr) {
      console.warn('Fan point history cleanup skipped:', historyErr.message);
    }

    await User.findByIdAndDelete(target._id);

    return successResponse(res, 200, 'User deleted permanently', {
      user: deletedUser
    });
  } catch (err) {
    return serverError(res, err, 'Admin user delete failed');
  }
};

/* ── ADMIN: FAN POINTS SUMMARY ── */
exports.adminGetFanPointSummary = async (req, res) => {
  try {
    const userId = req.params.id;

    const target = await User.findById(userId).select('firstName lastName email fanPoints fanTier');
    if (!target) return errorResponse(res, 404, 'User not found');

    const grouped = await FanPoints.aggregate([
      { $match: { user: target._id } },
      { $group: { _id: '$action', totalPoints: { $sum: '$points' }, count: { $sum: 1 } } },
      { $sort: { totalPoints: -1 } }
    ]);

    const labelMap = {
      purchase: 'Signup Bonus',
      poll_vote: 'Poll Vote',
      trivia: 'Trivia Correct',
      trivia_answer: 'Trivia Answer',
      trivia_correct: 'Trivia Correct',
      download: 'Wallpaper Download',
      fan_post: 'Fan Post / Comment',
      admin_adjust: 'Admin Reward',
      admin_deduct: 'Admin Deduction',
      admin_reset: 'Admin Reset'
    };

    const actions = grouped.map(item => ({
      action: item._id || 'unknown',
      label: labelMap[item._id] || String(item._id || 'Unknown').replace(/_/g, ' '),
      points: item.totalPoints || 0,
      totalPoints: item.totalPoints || 0,
      count: item.count || 0
    }));

    return successResponse(res, 200, 'Fan point summary fetched', {
      user: publicUser(target),
      actions
    });
  } catch (err) {
    return serverError(res, err, 'Admin fan point summary failed');
  }
};

/* ── ADMIN: ADD / DEDUCT / RESET FAN POINTS ── */
exports.adminAdjustFanPoints = async (req, res) => {
  try {
    const userId = req.params.id;
    const mode = String(req.body.mode || 'add').toLowerCase();
    const rawAmount = Number(req.body.amount || 0);
    const reason = String(req.body.reason || '').trim();

    const target = await User.findById(userId);
    if (!target) return errorResponse(res, 404, 'User not found');

    const before = Number(target.fanPoints || 0);
    let delta = 0;

    if (mode === 'reset') {
      delta = -before;
      target.fanPoints = 0;
    } else {
      if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
        return errorResponse(res, 400, 'Valid points amount required');
      }

      delta = mode === 'deduct' ? -Math.abs(rawAmount) : Math.abs(rawAmount);
      target.fanPoints = Math.max(0, before + delta);
    }

    if (typeof target.updateFanTier === 'function') {
      target.updateFanTier();
    }

    await target.save({ validateBeforeSave:false });

    try {
      await FanPoints.create({
        user: target._id,
        action: mode === 'reset' ? 'admin_reset' : (delta < 0 ? 'admin_deduct' : 'admin_adjust'),
        points: delta,
        meta: {
          mode,
          reason,
          before,
          after: target.fanPoints,
          adjustedBy: req.user?._id
        }
      });
    } catch (logErr) {
      console.warn('Fan point admin history log failed:', logErr.message);
    }

    return successResponse(res, 200, 'Fan points updated', {
      user: publicUser(target),
      before,
      after: target.fanPoints,
      delta
    });
  } catch (err) {
    return serverError(res, err, 'Admin fan points update failed');
  }
};

