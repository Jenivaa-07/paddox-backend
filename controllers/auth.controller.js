/* ============================================================
   FILE: controllers/auth.controller.js
   ============================================================ */
const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const User   = require('../models/User');
const FanPoints = require('../models/FanPoints');
const { generateAccessToken, generateRefreshToken, setAccessCookie, setRefreshCookie, clearAccessCookie, clearRefreshCookie } = require('../utils/generateToken');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { sendEmail } = require('../config/resend');


/* ── A4.7C.4: Email 2FA + session helpers ── */
function hash2FACode(code = '') {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function make2FACode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function userPublic(user) {
  return {
    id:user._id,
    firstName:user.firstName,
    lastName:user.lastName,
    email:user.email,
    role:user.role,
    avatar:user.avatar?.url,
    fanPoints:user.fanPoints,
    fanTier:user.fanTier,
    security: {
      twoFactor: {
        enabled: !!user.security?.twoFactor?.enabled,
        enabledAt: user.security?.twoFactor?.enabledAt || null
      }
    }
  };
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

function createSessionId() {
  return `pdx_sess_${crypto.randomBytes(16).toString('hex')}`;
}

async function attachSession(user, req, res) {
  const sessionId = createSessionId();
  const ua = req.get('user-agent') || '';
  if (!user.security) user.security = {};
  if (!Array.isArray(user.security.sessions)) user.security.sessions = [];
  user.security.sessions.unshift({
    sessionId,
    browser: getBrowserName(ua),
    device: getDeviceName(ua),
    ip: req.ip || '',
    userAgent: ua,
    lastSeen: new Date(),
    createdAt: new Date(),
    revoked: false
  });
  user.security.sessions = user.security.sessions.slice(0, 8);
  await user.save({ validateBeforeSave:false });
  if (res?.setHeader) res.setHeader('X-Paddox-Session-Id', sessionId);
  return sessionId;
}

async function sendLogin2FACode(user) {
  if (!user || !user.email) {
    throw new Error('2FA email recipient missing. User query did not include email.');
  }

  const code = make2FACode();
  if (!user.security) user.security = {};
  if (!user.security.twoFactor) user.security.twoFactor = {};
  user.security.twoFactor.codeHash = hash2FACode(code);
  user.security.twoFactor.codeExpires = new Date(Date.now() + 10 * 60 * 1000);
  user.security.twoFactor.pendingAction = 'login';
  user.security.twoFactor.lastSentAt = new Date();
  await user.save({ validateBeforeSave:false });

  const emailResult = await sendEmail(
    user.email,
    '🔐 PADDOX Login Verification Code',
    `<div style="font-family:Arial,sans-serif;background:#080808;color:#fff;padding:28px;border-radius:14px;border:1px solid #222">
      <div style="letter-spacing:5px;color:#e8002d;font-size:12px;font-weight:700">PADDOX SECURE LOGIN</div>
      <h2 style="margin:10px 0 8px;font-size:26px">Verify your login</h2>
      <p style="color:#c9c9c9;line-height:1.6">Enter this code on PADDOX to complete your secure sign-in.</p>
      <div style="font-size:34px;font-weight:900;letter-spacing:8px;background:#141414;border:1px solid #333;padding:16px 20px;display:inline-block;margin:16px 0;color:#fff">${code}</div>
      <p style="color:#777;font-size:12px">This code expires in 10 minutes.</p>
    </div>`
  );

  if (!emailResult || emailResult.success === false) {
    console.error('PADDOX Brevo login 2FA delivery rejected:', {
      to: user.email,
      provider: emailResult?.provider || 'brevo',
      status: emailResult?.status || '',
      message: emailResult?.message || 'Unknown Brevo delivery error',
      data: emailResult?.data || null
    });
    throw new Error(emailResult?.message || 'Brevo could not send the login verification email');
  }

  console.log('PADDOX Brevo login 2FA delivery accepted:', {
    to: user.email,
    provider: emailResult.provider || 'brevo',
    messageId: emailResult.messageId || '',
    previewOnly: !!emailResult.previewOnly
  });

  return jwt.sign(
    { id:String(user._id), purpose:'paddox_2fa_login' },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn:'10m' }
  );
}

async function completeLogin(user, req, res, message = 'Login successful') {
  const accessToken  = generateAccessToken(user._id, user.role);
  const refreshToken = generateRefreshToken(user._id);
  user.refreshToken  = refreshToken;
  user.lastLogin     = new Date();
  await user.save({ validateBeforeSave:false });
  const sessionId = await attachSession(user, req, res);
  setAccessCookie(res, accessToken);
  setRefreshCookie(res, refreshToken);
  // NOTE: accessToken is NOT returned in the body. It is delivered exclusively
  // as an HttpOnly cookie to prevent localStorage XSS exposure.
  return successResponse(res, 200, message, {
    sessionId,
    user: userPublic(user)
  });
}

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

    setAccessCookie(res, accessToken);
    setRefreshCookie(res, refreshToken);

    /* Send welcome email */
    await sendEmail(
      user.email,
      '🏁 Welcome to Paddox — You\'re in the Paddock!',
      `<h1>Welcome, ${user.firstName}!</h1><p>Your Paddox fan account is ready. Start exploring exclusive F1 merch and digital content.</p>`
    );

    // Access token is not returned in body — delivered as HttpOnly cookie only.
    successResponse(res, 201, 'Account created successfully', {
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

    if (user.security?.twoFactor?.enabled) {
      try {
        const twoFactorToken = await sendLogin2FACode(user);
        console.log('PADDOX Brevo login 2FA code sent:', user.email);
        return successResponse(res, 200, 'Verification code sent', {
          requires2FA: true,
          twoFactorToken,
          email: user.email
        });
      } catch (mailErr) {
        console.error('PADDOX login 2FA email failed:', mailErr.message);
        return errorResponse(res, 500, 'Could not send 2FA email. Please try again.');
      }
    }

    return completeLogin(user, req, res, 'Login successful');
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

    setAccessCookie(res, newAccessToken);
    setRefreshCookie(res, newRefreshToken);
    successResponse(res, 200, 'Token refreshed', {});
  } catch (err) { next(err); }
};

/* ── LOGOUT ── */
exports.logout = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { refreshToken:'' });
    clearRefreshCookie(res);
    clearAccessCookie(res);
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


/* ── GOOGLE LOGIN CONFIG ── */
exports.googleConfig = async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  return successResponse(res, 200, clientId ? 'Google login configured' : 'Google login not configured', {
    clientId
  });
};

/* ── GOOGLE LOGIN ── */
exports.googleLogin = async (req, res, next) => {
  try {
    const credential = String(req.body.credential || '').trim();
    const clientId = process.env.GOOGLE_CLIENT_ID || '';

    if (!clientId) return errorResponse(res, 500, 'Google login is not configured on backend');
    if (!credential) return errorResponse(res, 400, 'Google credential missing');

    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    const profile = await verifyRes.json().catch(() => ({}));

    if (!verifyRes.ok || profile.error_description || !profile.email) {
      return errorResponse(res, 401, profile.error_description || 'Invalid Google credential');
    }

    if (String(profile.aud || '') !== String(clientId)) {
      return errorResponse(res, 401, 'Google client mismatch');
    }

    const emailVerified = profile.email_verified === true || profile.email_verified === 'true';
    if (!emailVerified) return errorResponse(res, 401, 'Google email is not verified');

    const email = String(profile.email || '').trim().toLowerCase();
    const givenName = String(profile.given_name || profile.name || 'Paddox').trim();
    const familyName = String(profile.family_name || '').trim();

    let user = await User.findOne({ email }).select('+refreshToken');
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      user = await User.create({
        firstName: givenName || 'Paddox',
        lastName: familyName || 'Fan',
        email,
        password: crypto.randomBytes(32).toString('hex'),
        avatar: profile.picture ? { url: profile.picture, publicId: '' } : undefined,
        preferences: { favouriteTeam: '' }
      });

      try {
        await FanPoints.create({ user:user._id, action:'purchase', points:100, meta:{ note:'Google signup welcome bonus' } });
        user.fanPoints = (user.fanPoints || 0) + 100;
        if (typeof user.updateFanTier === 'function') user.updateFanTier();
      } catch (pointsErr) {
        console.warn('Google signup fan points failed:', pointsErr.message);
      }
    } else if (profile.picture && !user.avatar?.url) {
      user.avatar = { url: profile.picture, publicId: '' };
    }

    if (user.isBanned) return errorResponse(res, 403, 'Account suspended');

    if (user.security?.twoFactor?.enabled) {
      try {
        const twoFactorToken = await sendLogin2FACode(user);
        console.log('PADDOX Brevo Google login 2FA code sent:', user.email);
        return successResponse(res, 200, 'Verification code sent', {
          requires2FA: true,
          twoFactorToken,
          email: user.email
        });
      } catch (mailErr) {
        console.error('PADDOX Google login 2FA email failed:', mailErr.message);
        return errorResponse(res, 500, 'Could not send 2FA email. Please try again.');
      }
    }

    if (isNewUser) {
      try {
        await sendEmail(
          user.email,
          '🏁 Welcome to PADDOX — Google Sign-In Connected',
          `<div style="font-family:Arial,sans-serif;background:#080808;color:#fff;padding:28px;border-radius:14px;border:1px solid #222">
            <div style="letter-spacing:5px;color:#e8002d;font-size:12px;font-weight:700">PADDOX</div>
            <h2 style="margin:10px 0 8px;font-size:26px">Welcome, ${user.firstName}!</h2>
            <p style="color:#c9c9c9;line-height:1.6">Your PADDOX fan account is ready. Explore premium motorsport merch, Fan Hub wallpapers, and account downloads.</p>
          </div>`
        );
        console.log('PADDOX Google welcome email sent:', user.email);
      } catch (mailErr) {
        console.warn('Google welcome email failed:', mailErr.message);
      }
    }

    return completeLogin(user, req, res, isNewUser ? 'Google account created' : 'Google login successful');
  } catch (err) { next(err); }
};


/* ── SEND / RESEND LOGIN 2FA CODE ──
   Used before full login is completed.
   Supports POST body and GET query fallback for older frontend cache.
*/
exports.sendLoginTwoFactorCode = async (req, res, next) => {
  try {
    const twoFactorToken = String(req.body?.twoFactorToken || req.query?.twoFactorToken || req.query?.token || '').trim();

    if (!twoFactorToken) {
      return errorResponse(res, 400, 'Two-factor login token is required');
    }

    let decoded;
    try {
      decoded = jwt.verify(twoFactorToken, process.env.JWT_ACCESS_SECRET);
    } catch (_) {
      return errorResponse(res, 401, 'Two-factor session expired. Login again.');
    }

    if (decoded.purpose !== 'paddox_2fa_login') {
      return errorResponse(res, 401, 'Invalid two-factor session');
    }

    const user = await User.findById(decoded.id).select('+refreshToken');

    if (!user) return errorResponse(res, 404, 'User not found');
    if (user.isBanned) return errorResponse(res, 403, 'Account suspended');
    if (!user.security?.twoFactor?.enabled) {
      return errorResponse(res, 400, 'Two-factor authentication is not enabled for this account');
    }

    const freshTwoFactorToken = await sendLogin2FACode(user);

    console.log('PADDOX Brevo login 2FA code sent/resend route:', user.email);

    return successResponse(res, 200, 'Verification code sent', {
      requires2FA: true,
      twoFactorToken: freshTwoFactorToken,
      email: user.email,
      emailTo: user.email
    });
  } catch (err) {
    console.error('PADDOX login 2FA send route failed:', err.message);
    return errorResponse(res, 500, err.message || 'Could not send 2FA email. Please try again.');
  }
};


/* ── VERIFY LOGIN 2FA ── */
exports.verifyLoginTwoFactor = async (req, res, next) => {
  try {
    const { twoFactorToken = '', code = '' } = req.body;
    if (!twoFactorToken || !/^\d{6}$/.test(String(code))) {
      return errorResponse(res, 400, 'Two-factor token and valid 6-digit code are required');
    }

    let decoded;
    try {
      decoded = jwt.verify(twoFactorToken, process.env.JWT_ACCESS_SECRET);
    } catch (_) {
      return errorResponse(res, 401, 'Two-factor session expired. Login again.');
    }

    if (decoded.purpose !== 'paddox_2fa_login') {
      return errorResponse(res, 401, 'Invalid two-factor session');
    }

    const user = await User.findById(decoded.id).select('+refreshToken');
    if (!user) return errorResponse(res, 404, 'User not found');
    if (user.isBanned) return errorResponse(res, 403, 'Account suspended');

    const twoFactor = user.security?.twoFactor || {};
    if (!twoFactor.codeHash || !twoFactor.codeExpires || new Date(twoFactor.codeExpires).getTime() < Date.now()) {
      return errorResponse(res, 400, 'Verification code expired. Login again.');
    }
    if (twoFactor.codeHash !== hash2FACode(code)) {
      return errorResponse(res, 400, 'Invalid verification code');
    }

    user.security.twoFactor.codeHash = '';
    user.security.twoFactor.codeExpires = null;
    user.security.twoFactor.pendingAction = '';
    await user.save({ validateBeforeSave:false });

    return completeLogin(user, req, res, 'Secure login successful');
  } catch (err) { next(err); }
};
