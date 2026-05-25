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
    const assets = await DigitalAsset.find({ type:'free', isActive:true }).select('-__v');
    return successResponse(res, 200, 'Downloads fetched', { assets });

  } catch (err) {
    return serverError(res, err, 'Get downloads failed');
  }
};
