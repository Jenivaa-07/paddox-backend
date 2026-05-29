/* ============================================================
   FILE: controllers/auth.controller.js
   PADDOX — Auth + Google Login + Email 2FA
   ============================================================ */
const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const axios  = require('axios');
const User   = require('../models/User');
const FanPoints = require('../models/FanPoints');
const { generateAccessToken, generateRefreshToken, setRefreshCookie, clearRefreshCookie } = require('../utils/generateToken');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { sendEmail } = require('../config/resend');

function safeUser(user) {
  if (!user) return null;
  const obj = user.toSafeObject ? user.toSafeObject() : (user.toObject ? user.toObject() : user);
  delete obj.password;
  delete obj.refreshToken;
  if (obj.security?.twoFactor) {
    delete obj.security.twoFactor.codeHash;
    delete obj.security.twoFactor.codeExpires;
    delete obj.security.twoFactor.pendingAction;
  }
  return obj;
}

function publicAuthUser(user) {
  const safe = safeUser(user) || {};
  return {
    id: safe._id || safe.id,
    firstName: safe.firstName,
    lastName: safe.lastName,
    email: safe.email,
    role: safe.role,
    avatar: safe.avatar,
    fanPoints: safe.fanPoints,
    fanTier: safe.fanTier,
    preferences: safe.preferences,
    notifications: safe.notifications,
    security: safe.security,
    authProvider: safe.authProvider
  };
}

function otpHash(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function createOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendTwoFactorCode(user, action = 'login') {
  const code = createOtpCode();
  user.security = user.security || {};
  user.security.twoFactor = user.security.twoFactor || {};
  user.security.twoFactor.codeHash = otpHash(code);
  user.security.twoFactor.codeExpires = new Date(Date.now() + 10 * 60 * 1000);
  user.security.twoFactor.pendingAction = action;
  await user.save({ validateBeforeSave:false });

  await sendEmail(
    user.email,
    'PADDOX security code',
    `
      <div style="font-family:Arial,sans-serif;background:#080808;color:#fff;padding:24px">
        <h2 style="letter-spacing:2px">PADDOX SECURITY CODE</h2>
        <p>Your verification code is:</p>
        <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#e8002d;margin:18px 0">${code}</div>
        <p>This code expires in 10 minutes. If you did not request this, ignore this email.</p>
      </div>
    `
  );

  return code;
}

async function finishLogin(user, res, message = 'Login successful') {
  const accessToken  = generateAccessToken(user._id, user.role);
  const refreshToken = generateRefreshToken(user._id);
  user.refreshToken  = refreshToken;
  user.lastLogin     = new Date();
  if (user.security?.twoFactor) {
    user.security.twoFactor.codeHash = undefined;
    user.security.twoFactor.codeExpires = undefined;
    user.security.twoFactor.pendingAction = '';
    user.security.twoFactor.lastVerifiedAt = new Date();
  }
  await user.save({ validateBeforeSave:false });
  setRefreshCookie(res, refreshToken);
  return successResponse(res, 200, message, { accessToken, user: publicAuthUser(user) });
}

function createTwoFactorToken(user) {
  return jwt.sign(
    { id:String(user._id), purpose:'paddox-2fa' },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn:'10m' }
  );
}

async function maybeRequireTwoFactor(user, res) {
  if (user.security?.twoFactor?.enabled) {
    await sendTwoFactorCode(user, 'login');
    return successResponse(res, 200, 'Two-factor code sent', {
      requires2FA: true,
      twoFactorToken: createTwoFactorToken(user),
      email: user.email
    });
  }
  return finishLogin(user, res);
}

/* ── REGISTER ── */
exports.register = async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, favouriteTeam } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return errorResponse(res, 400, 'Email already registered');

    const user = await User.create({
      firstName, lastName, email, password,
      authProvider:'local',
      preferences: { favouriteTeam: favouriteTeam || '' },
      isVerified:true
    });

    await FanPoints.create({ user:user._id, action:'purchase', points:100, meta:{ note:'Welcome bonus' } });
    user.fanPoints = 100;
    user.updateFanTier();
    await user.save();

    const accessToken  = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id);
    user.refreshToken  = refreshToken;
    user.lastLogin     = new Date();
    await user.save({ validateBeforeSave:false });

    setRefreshCookie(res, refreshToken);

    await sendEmail(
      user.email,
      'Welcome to PADDOX',
      `<h1>Welcome, ${user.firstName}!</h1><p>Your PADDOX fan account is ready.</p>`
    );

    successResponse(res, 201, 'Account created successfully', {
      accessToken,
      user: publicAuthUser(user),
    });
  } catch (err) { next(err); }
};

/* ── LOGIN ── */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return errorResponse(res, 400, 'Email and password required');

    const user = await User.findOne({ email }).select('+password +refreshToken +security.twoFactor.codeHash +security.twoFactor.codeExpires');
    if (!user)         return errorResponse(res, 401, 'Invalid credentials');
    if (user.isBanned) return errorResponse(res, 403, 'Account suspended');
    const match = await user.matchPassword(password);
    if (!match)        return errorResponse(res, 401, 'Invalid credentials');

    return maybeRequireTwoFactor(user, res);
  } catch (err) { next(err); }
};

/* ── VERIFY 2FA LOGIN ── */
exports.verifyTwoFactorLogin = async (req, res, next) => {
  try {
    const { twoFactorToken, code } = req.body;
    if (!twoFactorToken || !code) return errorResponse(res, 400, 'Code required');

    let decoded;
    try {
      decoded = jwt.verify(twoFactorToken, process.env.JWT_ACCESS_SECRET);
    } catch {
      return errorResponse(res, 401, 'Two-factor session expired. Please login again.');
    }
    if (decoded.purpose !== 'paddox-2fa') return errorResponse(res, 401, 'Invalid verification session');

    const user = await User.findById(decoded.id).select('+refreshToken +security.twoFactor.codeHash +security.twoFactor.codeExpires');
    if (!user) return errorResponse(res, 404, 'User not found');

    const twoFactor = user.security?.twoFactor || {};
    if (!twoFactor.codeHash || !twoFactor.codeExpires || twoFactor.codeExpires < new Date()) {
      return errorResponse(res, 400, 'Verification code expired');
    }
    if (twoFactor.codeHash !== otpHash(code)) {
      return errorResponse(res, 400, 'Invalid verification code');
    }

    return finishLogin(user, res, 'Two-factor verified');
  } catch (err) { next(err); }
};

/* ── GOOGLE CONFIG ── */
exports.googleConfig = async (req, res) => {
  return successResponse(res, 200, 'Google config fetched', {
    clientId: process.env.GOOGLE_CLIENT_ID || ''
  });
};

/* ── GOOGLE LOGIN ── */
exports.googleLogin = async (req, res, next) => {
  try {
    const { credential } = req.body;
    if (!credential) return errorResponse(res, 400, 'Google credential required');
    if (!process.env.GOOGLE_CLIENT_ID) return errorResponse(res, 500, 'Google login is not configured');

    const googleRes = await axios.get('https://oauth2.googleapis.com/tokeninfo', {
      params: { id_token: credential },
      timeout: 10000
    });
    const profile = googleRes.data || {};

    if (profile.aud !== process.env.GOOGLE_CLIENT_ID) {
      return errorResponse(res, 401, 'Invalid Google client');
    }
    if (!profile.email || profile.email_verified !== 'true') {
      return errorResponse(res, 401, 'Google email is not verified');
    }

    let user = await User.findOne({ email: profile.email }).select('+refreshToken +security.twoFactor.codeHash +security.twoFactor.codeExpires');

    if (!user) {
      const randomPassword = crypto.randomBytes(24).toString('hex');
      user = await User.create({
        firstName: profile.given_name || profile.name || 'PADDOX',
        lastName: profile.family_name || '',
        email: profile.email,
        password: randomPassword,
        authProvider: 'google',
        googleId: profile.sub || '',
        avatar: { url: profile.picture || '', publicId: '' },
        isVerified: true
      });
      await FanPoints.create({ user:user._id, action:'purchase', points:100, meta:{ note:'Google signup welcome bonus' } });
      user.fanPoints = 100;
      user.updateFanTier();
      await user.save({ validateBeforeSave:false });
    } else {
      user.authProvider = user.authProvider === 'local' ? 'local' : 'google';
      user.googleId = user.googleId || profile.sub || '';
      if (!user.avatar?.url && profile.picture) user.avatar = { url: profile.picture, publicId: '' };
    }

    if (user.isBanned) return errorResponse(res, 403, 'Account suspended');
    return maybeRequireTwoFactor(user, res);
  } catch (err) {
    console.error('Google login failed', err.message);
    return errorResponse(res, 401, 'Google login failed');
  }
};

/* ── REFRESH TOKEN ── */
exports.refresh = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return errorResponse(res, 401, 'No refresh token');

    let decoded;
    try { decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET); }
    catch { return errorResponse(res, 401, 'Invalid or expired refresh token'); }

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
    successResponse(res, 200, 'User fetched', { user: publicAuthUser(user) });
  } catch (err) { next(err); }
};

/* ── FORGOT PASSWORD ── */
exports.forgotPassword = async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) return errorResponse(res, 404, 'No account with that email');

    const resetToken   = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken  = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpire = Date.now() + 10 * 60 * 1000;
    await user.save({ validateBeforeSave:false });

    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
    await sendEmail(
      user.email,
      'PADDOX password reset request',
      `<p>Click the link below to reset your password. This link expires in 10 minutes.</p><a href="${resetUrl}">${resetUrl}</a>`
    );

    successResponse(res, 200, 'Password reset email sent');
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
    user.security = user.security || {};
    user.security.passwordChangedAt = new Date();
    await user.save();

    successResponse(res, 200, 'Password reset successful. Please log in.');
  } catch (err) { next(err); }
};
