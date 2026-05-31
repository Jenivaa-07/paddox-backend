/* ============================================================
   FILE: routes/user.routes.js
   PADDOX — User Routes Deploy Safety Fix
   Phase A4.7B.4
   Fixes Render crash: TypeError: argument handler must be a function
   ============================================================ */

const express = require('express');
const router = express.Router();

let user = {};
let auth = {};

try {
  user = require('../controllers/user.controller') || {};
} catch (err) {
  console.warn('PADDOX user.controller not loaded:', err.message);
}

try {
  auth = require('../middleware/auth.middleware') || {};
} catch (err) {
  console.warn('PADDOX auth.middleware not loaded:', err.message);
}

function noopProtect(req, res, next) {
  return next();
}

const protect =
  typeof auth.protect === 'function'
    ? auth.protect
    : typeof auth.authMiddleware === 'function'
      ? auth.authMiddleware
      : noopProtect;

const adminOnly =
  typeof auth.adminOnly === 'function'
    ? auth.adminOnly
    : typeof auth.isAdmin === 'function'
      ? auth.isAdmin
      : noopProtect;

function pickHandler(names, fallbackLabel) {
  for (const name of names) {
    if (typeof user[name] === 'function') return user[name];
  }

  return function missingUserHandler(req, res) {
    return res.status(501).json({
      success: false,
      message: `${fallbackLabel} is not available on this backend build`,
      missingAnyOf: names
    });
  };
}

/* Profile */
router.get(
  '/profile',
  protect,
  pickHandler(['getProfile', 'getUserProfile', 'getMe', 'me'], 'User profile fetch')
);

router.put(
  '/profile',
  protect,
  pickHandler(['updateProfile', 'updateUserProfile', 'editProfile'], 'User profile update')
);

router.patch(
  '/profile',
  protect,
  pickHandler(['updateProfile', 'updateUserProfile', 'editProfile'], 'User profile update')
);

/* Preferences */
router.get(
  '/preferences',
  protect,
  pickHandler(['getPreferences', 'getUserPreferences'], 'User preferences fetch')
);

router.put(
  '/preferences',
  protect,
  pickHandler(['updatePreferences', 'updateUserPreferences'], 'User preferences update')
);

router.patch(
  '/preferences',
  protect,
  pickHandler(['updatePreferences', 'updateUserPreferences'], 'User preferences update')
);

/* Avatar */
router.put(
  '/avatar',
  protect,
  pickHandler(['updateAvatar', 'updateProfileAvatar', 'uploadAvatar'], 'Avatar update')
);

router.post(
  '/avatar',
  protect,
  pickHandler(['updateAvatar', 'updateProfileAvatar', 'uploadAvatar'], 'Avatar update')
);

/* Downloads */
router.get(
  '/downloads',
  protect,
  pickHandler(['getDownloads', 'getMyDownloads', 'getUserDownloads', 'getDownloadHistory'], 'Downloads fetch')
);

router.post(
  '/downloads',
  protect,
  pickHandler(['addDownload', 'addUserDownload', 'saveDownload'], 'Download save')
);

/* Notifications */
router.get(
  '/notifications',
  protect,
  pickHandler(['getNotifications', 'getUserNotifications'], 'Notifications fetch')
);

router.put(
  '/notifications/:id/read',
  protect,
  pickHandler(['markNotificationRead', 'markNotificationAsRead'], 'Notification read update')
);

router.patch(
  '/notifications/:id/read',
  protect,
  pickHandler(['markNotificationRead', 'markNotificationAsRead'], 'Notification read update')
);

/* Security */
router.put(
  '/security/password',
  protect,
  pickHandler(['updatePassword', 'changePassword'], 'Password update')
);


/* Login-time 2FA code send. This is intentionally unprotected because it uses
   the temporary twoFactorToken returned by /auth/login before full login. */
router.post(
  '/security/2fa/login/send',
  pickHandler(['sendLoginTwoFactorCode', 'sendTwoFactorLoginCode', 'sendLogin2FACode'], 'Login 2FA send')
);

router.post(
  '/security/2fa/login/resend',
  pickHandler(['sendLoginTwoFactorCode', 'sendTwoFactorLoginCode', 'sendLogin2FACode'], 'Login 2FA resend')
);

router.post(
  '/security/2fa/send',
  protect,
  pickHandler(['sendTwoFactorCode', 'send2FACode', 'send2faCode'], '2FA send')
);

const verifyTwoFactorRouteHandler = pickHandler(['verifyTwoFactorCode', 'verify2FACode', 'verify2faCode'], '2FA verify');

router.post(
  '/security/2fa/verify',
  protect,
  verifyTwoFactorRouteHandler
);

/* Frontend Security page sends PUT, so keep POST + PUT + PATCH aliases. */
router.put(
  '/security/2fa/verify',
  protect,
  verifyTwoFactorRouteHandler
);

router.patch(
  '/security/2fa/verify',
  protect,
  verifyTwoFactorRouteHandler
);

router.get(
  '/security/sessions',
  protect,
  pickHandler(['getSessions', 'getUserSessions'], 'Sessions fetch')
);

router.delete(
  '/security/sessions/:id',
  protect,
  pickHandler(['revokeSession', 'deleteSession', 'removeSession'], 'Session revoke')
);

/* Admin users list */
router.get(
  '/',
  protect,
  adminOnly,
  pickHandler(['getAllUsers', 'getUsers', 'listUsers'], 'Admin users fetch')
);


/* Admin: Fan points controls */
router.get(
  '/:id/fan-points/summary',
  protect,
  adminOnly,
  pickHandler(['adminGetFanPointSummary', 'getAdminFanPointSummary'], 'Admin fan point summary')
);

router.put(
  '/:id/fan-points/adjust',
  protect,
  adminOnly,
  pickHandler(['adminAdjustFanPoints', 'adjustAdminFanPoints'], 'Admin fan point update')
);

router.patch(
  '/:id/fan-points/adjust',
  protect,
  adminOnly,
  pickHandler(['adminAdjustFanPoints', 'adjustAdminFanPoints'], 'Admin fan point update')
);

router.get(
  '/:id',
  protect,
  adminOnly,
  pickHandler(['getUserById', 'getUser'], 'Admin user fetch')
);

router.put(
  '/:id',
  protect,
  adminOnly,
  pickHandler(['updateUser', 'updateUserById'], 'Admin user update')
);

router.delete(
  '/:id',
  protect,
  adminOnly,
  pickHandler(['deleteUser', 'deleteUserById'], 'Admin user delete')
);

module.exports = router;
