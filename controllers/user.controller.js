/* ============================================================
   FILE: controllers/user.controller.js
   PADDOX — REALTIME USER PROFILE CONTROLLER
   ============================================================ */
const User       = require('../models/User');
const FanPoints  = require('../models/FanPoints');
const DigitalAsset = require('../models/DigitalAsset');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { cloudinary } = require('../config/cloudinary');
const crypto = require('crypto');
const { sendEmail } = require('../config/resend');

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



/* ══════════════════════════════════════
   SECURITY — PASSWORD + EMAIL 2FA
══════════════════════════════════════ */
function securityOtpHash(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function securityOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function emailSecurityCode(user, action) {
  const code = securityOtpCode();
  user.security = user.security || {};
  user.security.twoFactor = user.security.twoFactor || {};
  user.security.twoFactor.codeHash = securityOtpHash(code);
  user.security.twoFactor.codeExpires = new Date(Date.now() + 10 * 60 * 1000);
  user.security.twoFactor.pendingAction = action;
  await user.save({ validateBeforeSave:false });

  await sendEmail(
    user.email,
    `PADDOX ${action === 'enable' ? 'enable' : 'disable'} 2FA code`,
    `
      <div style="font-family:Arial,sans-serif;background:#080808;color:#fff;padding:24px">
        <h2>PADDOX SECURITY</h2>
        <p>Use this code to ${action} email two-factor authentication:</p>
        <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#e8002d;margin:18px 0">${code}</div>
        <p>This code expires in 10 minutes.</p>
      </div>
    `
  );
}

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return errorResponse(res, 400, 'Current and new password required');
    if (String(newPassword).length < 8) return errorResponse(res, 400, 'New password must be at least 8 characters');

    const user = await User.findById(req.user._id).select('+password +refreshToken');
    if (!user) return errorResponse(res, 404, 'User not found');

    const ok = await user.matchPassword(currentPassword);
    if (!ok) return errorResponse(res, 401, 'Current password is incorrect');

    user.password = newPassword;
    user.refreshToken = '';
    user.security = user.security || {};
    user.security.passwordChangedAt = new Date();
    await user.save();

    return successResponse(res, 200, 'Password updated. Please login again.');
  } catch (err) {
    return serverError(res, err, 'Password update failed');
  }
};

exports.sendTwoFactorSetupCode = async (req, res) => {
  try {
    const { currentPassword, action = 'enable' } = req.body;
    if (!['enable','disable'].includes(action)) return errorResponse(res, 400, 'Invalid 2FA action');
    if (!currentPassword) return errorResponse(res, 400, 'Current password required');

    const user = await User.findById(req.user._id).select('+password +security.twoFactor.codeHash +security.twoFactor.codeExpires');
    if (!user) return errorResponse(res, 404, 'User not found');

    const ok = await user.matchPassword(currentPassword);
    if (!ok) return errorResponse(res, 401, 'Current password is incorrect');

    await emailSecurityCode(user, action);
    return successResponse(res, 200, `Verification code sent to ${user.email}`, { action, email:user.email });
  } catch (err) {
    return serverError(res, err, '2FA code send failed');
  }
};

exports.verifyTwoFactorSetup = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return errorResponse(res, 400, 'Verification code required');

    const user = await User.findById(req.user._id).select('+security.twoFactor.codeHash +security.twoFactor.codeExpires');
    if (!user) return errorResponse(res, 404, 'User not found');

    const twoFactor = user.security?.twoFactor || {};
    if (!twoFactor.codeHash || !twoFactor.codeExpires || twoFactor.codeExpires < new Date()) {
      return errorResponse(res, 400, 'Verification code expired');
    }
    if (twoFactor.codeHash !== securityOtpHash(code)) {
      return errorResponse(res, 400, 'Invalid verification code');
    }

    const action = twoFactor.pendingAction || 'enable';
    user.security.twoFactor.enabled = action === 'enable';
    user.security.twoFactor.method = 'email';
    user.security.twoFactor.codeHash = undefined;
    user.security.twoFactor.codeExpires = undefined;
    user.security.twoFactor.pendingAction = '';
    user.security.twoFactor.lastVerifiedAt = new Date();
    await user.save({ validateBeforeSave:false });

    const fresh = await User.findById(user._id).select('-password -refreshToken');
    return successResponse(res, 200, `Two-factor authentication ${action === 'enable' ? 'enabled' : 'disabled'}`, { user: publicUser(fresh) });
  } catch (err) {
    return serverError(res, err, '2FA verification failed');
  }
};
