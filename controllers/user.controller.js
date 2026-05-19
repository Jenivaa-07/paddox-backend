
/* ============================================================
   FILE: controllers/user.controller.js
   ============================================================ */
const User       = require('../models/User');
const Order      = require('../models/Order');
const Wishlist   = require('../models/Wishlist');
const FanPoints  = require('../models/FanPoints');
const DigitalAsset = require('../models/DigitalAsset');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { cloudinary } = require('../config/cloudinary');

/* ── GET PROFILE ── */
exports.getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    successResponse(res, 200, 'Profile fetched', { user });
  } catch (err) { next(err); }
};

/* ── UPDATE PROFILE ── */
exports.updateProfile = async (req, res, next) => {
  try {
    const { firstName, lastName, phone, dateOfBirth, address } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { firstName, lastName, phone, dateOfBirth, address },
      { new:true, runValidators:true }
    );
    successResponse(res, 200, 'Profile updated', { user });
  } catch (err) { next(err); }
};

/* ── UPDATE AVATAR ── */
exports.updateAvatar = async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, 400, 'No image uploaded');
    const user = await User.findById(req.user._id);
    /* Delete old avatar from Cloudinary */
    if (user.avatar?.publicId) {
      await cloudinary.uploader.destroy(user.avatar.publicId);
    }
    user.avatar = { url: req.file.path, publicId: req.file.filename };
    await user.save({ validateBeforeSave:false });
    successResponse(res, 200, 'Avatar updated', { avatar: user.avatar });
  } catch (err) { next(err); }
};

/* ── UPDATE PREFERENCES ── */
exports.updatePreferences = async (req, res, next) => {
  try {
    const { favouriteTeam, favouriteDriver, newsletter } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { preferences: { favouriteTeam, favouriteDriver, newsletter } },
      { new:true }
    );
    successResponse(res, 200, 'Preferences updated', { preferences: user.preferences });
  } catch (err) { next(err); }
};

/* ── UPDATE NOTIFICATIONS ── */
exports.updateNotifications = async (req, res, next) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { notifications: req.body },
      { new:true }
    );
    successResponse(res, 200, 'Notification settings updated', { notifications: user.notifications });
  } catch (err) { next(err); }
};

/* ── GET FAN POINTS ── */
exports.getFanPoints = async (req, res, next) => {
  try {
    const user    = await User.findById(req.user._id).select('fanPoints fanTier');
    const history = await FanPoints.find({ user: req.user._id }).sort('-createdAt').limit(20);
    successResponse(res, 200, 'Fan points fetched', { fanPoints: user.fanPoints, fanTier: user.fanTier, history });
  } catch (err) { next(err); }
};

/* ── GET DOWNLOADS ── */
exports.getDownloads = async (req, res, next) => {
  try {
    /* Return free assets + any premium unlocked by user */
    const assets = await DigitalAsset.find({ type:'free', isActive:true }).select('-__v');
    successResponse(res, 200, 'Downloads fetched', { assets });
  } catch (err) { next(err); }
};

