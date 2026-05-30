/* ============================================================
   FILE: controllers/auth.controller.js
   ============================================================ */
const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const User   = require('../models/User');
const FanPoints = require('../models/FanPoints');
const { generateAccessToken, generateRefreshToken, setRefreshCookie, clearRefreshCookie } = require('../utils/generateToken');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { sendEmail } = require('../config/resend');

/* ── REGISTER ── */
exports.register = async (req, res, next) => {
  try {
    const { firstName, lastName, password, favouriteTeam } = req.body;
    const email = String(req.body.email || '').trim().toLowerCase();

    /* Check duplicate */
    const exists = await User.findOne({ email });
    if (exists) return errorResponse(res, 400, 'Email already registered');

    const user = await User.create({
      firstName, lastName, email, password,
      preferences: { favouriteTeam: favouriteTeam || '' },
    });

    /* Award welcome fan points */
    await FanPoints.create({ user:user._id, action:'purchase', points:100, meta:{ note:'Welcome bonus' } });
    user.fanPoints = 100;
    user.updateFanTier();
    await user.save();

    /* Generate tokens */
    const accessToken  = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id);
    user.refreshToken  = refreshToken;
    user.lastLogin     = new Date();
    await user.save({ validateBeforeSave:false });

    setRefreshCookie(res, refreshToken);

    /* Send welcome email */
    await sendEmail(
      user.email,
      '🏁 Welcome to Paddox — You\'re in the Paddock!',
      `<h1>Welcome, ${user.firstName}!</h1><p>Your Paddox fan account is ready. Start exploring exclusive F1 merch and digital content.</p>`
    );

    successResponse(res, 201, 'Account created successfully', {
      accessToken,
      user: { id:user._id, firstName:user.firstName, lastName:user.lastName, email:user.email, role:user.role, fanPoints:user.fanPoints, fanTier:user.fanTier },
    });
  } catch (err) { next(err); }
};

/* ── LOGIN ── */
exports.login = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const { password } = req.body;
    if (!email || !password) return errorResponse(res, 400, 'Email and password required');

    const user = await User.findOne({ email }).select('+password +refreshToken');
    if (!user)                      return errorResponse(res, 401, 'Invalid credentials');
    if (user.isBanned)              return errorResponse(res, 403, 'Account suspended');
    const match = await user.matchPassword(password);
    if (!match)                     return errorResponse(res, 401, 'Invalid credentials');

    const accessToken  = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id);
    user.refreshToken  = refreshToken;
    user.lastLogin     = new Date();
    await user.save({ validateBeforeSave:false });

    setRefreshCookie(res, refreshToken);

    successResponse(res, 200, 'Login successful', {
      accessToken,
      user: { id:user._id, firstName:user.firstName, lastName:user.lastName, email:user.email, role:user.role, avatar:user.avatar?.url, fanPoints:user.fanPoints, fanTier:user.fanTier },
    });
  } catch (err) { next(err); }
};

/* ── REFRESH TOKEN ── */
exports.refresh = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return errorResponse(res, 401, 'No refresh token');

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch {
      return errorResponse(res, 401, 'Invalid or expired refresh token');
    }

    const user = await User.findById(decoded.id).select('+refreshToken');
    if (!user || user.refreshToken !== token) {
      return errorResponse(res, 401, 'Refresh token mismatch — please log in again');
    }

    const newAccessToken  = generateAccessToken(user._id, user.role);
    const newRefreshToken = generateRefreshToken(user._id);
    user.refreshToken     = newRefreshToken;
    await user.save({ validateBeforeSave:false });

    setRefreshCookie(res, newRefreshToken);
    successResponse(res, 200, 'Token refreshed', { accessToken: newAccessToken });
  } catch (err) { next(err); }
};

/* ── LOGOUT ── */
exports.logout = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { refreshToken:'' });
    clearRefreshCookie(res);
    successResponse(res, 200, 'Logged out successfully');
  } catch (err) { next(err); }
};

/* ── GET ME ── */
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    successResponse(res, 200, 'User fetched', { user });
  } catch (err) { next(err); }
};

/* ── FORGOT PASSWORD ── */
exports.forgotPassword = async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user) return errorResponse(res, 404, 'No account with that email');

    const resetToken   = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken  = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 min
    await user.save({ validateBeforeSave:false });

    const resetUrl = `${(process.env.CLIENT_URL || 'https://paddox.vercel.app').replace(/\/$/, '')}/reset-password.html?token=${resetToken}`;
    let emailSent = false;
    let emailError = '';
    try {
      await sendEmail(
        user.email,
        '🔒 Paddox — Password Reset Request',
        `<div style="font-family:Arial,sans-serif;background:#080808;color:#fff;padding:28px;border-radius:14px;border:1px solid #222">
          <div style="letter-spacing:5px;color:#e8002d;font-size:12px;font-weight:700">PADDOX SECURITY</div>
          <h2 style="margin:10px 0 8px;font-size:26px">Reset your password</h2>
          <p style="color:#c9c9c9;line-height:1.6">Click the secure button below to reset your password. This link expires in 10 minutes.</p>
          <a href="${resetUrl}" style="display:inline-block;margin-top:16px;background:#e8002d;color:#fff;text-decoration:none;padding:14px 22px;font-weight:800;letter-spacing:2px;text-transform:uppercase">Reset Password</a>
          <p style="color:#777;font-size:12px;margin-top:20px">If the button does not work, copy this link:<br>${resetUrl}</p>
        </div>`
      );
      emailSent = true;
      console.log('PADDOX password reset email sent:', user.email);
    } catch (mailErr) {
      emailError = mailErr.message || 'Email send failed';
      console.error('PADDOX password reset email failed:', emailError);
    }

    successResponse(res, 200, emailSent ? 'Password reset email sent' : 'Reset link generated but email failed', {
      emailSent,
      emailTo: user.email,
      emailError
    });
  } catch (err) { next(err); }
};

/* ── RESET PASSWORD ── */
exports.resetPassword = async (req, res, next) => {
  try {
    const hashed = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user   = await User.findOne({
      resetPasswordToken : hashed,
      resetPasswordExpire: { $gt: Date.now() },
    });
    if (!user) return errorResponse(res, 400, 'Invalid or expired reset token');

    user.password            = req.body.password;
    user.resetPasswordToken  = undefined;
    user.resetPasswordExpire = undefined;
    user.refreshToken        = '';
    await user.save();

    successResponse(res, 200, 'Password reset successful. Please log in.');
  } catch (err) { next(err); }
};

