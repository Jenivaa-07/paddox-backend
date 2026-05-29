
/* ============================================================
   FILE: routes/user.routes.js
   ============================================================ */
const express = require('express');
const router  = express.Router();
const user    = require('../controllers/user.controller');
const { protect }  = require('../middleware/auth.middleware');
const { uploadAvatar } = require('../config/cloudinary');

router.use(protect); /* All user routes require auth */

router.get('/profile',          user.getProfile);
router.put('/profile',          user.updateProfile);
router.put('/avatar',           uploadAvatar.single('avatar'), user.updateAvatar);
router.put('/preferences',      user.updatePreferences);
router.put('/notifications',    user.updateNotifications);
router.get('/fan-points',       user.getFanPoints);
router.get('/downloads',        user.getDownloads);

/* Security */
router.put('/security/password', user.changePassword);
router.post('/security/2fa/send', user.sendTwoFactorSetupCode);
router.put('/security/2fa/verify', user.verifyTwoFactorSetup);
router.get('/security/sessions', user.getSecuritySessions);
router.delete('/security/sessions/others', user.revokeOtherSecuritySessions);
router.delete('/security/sessions/:sessionId', user.revokeSecuritySession);


module.exports = router;