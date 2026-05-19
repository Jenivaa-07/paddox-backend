
/* ============================================================
   FILE: routes/asset.routes.js
   ============================================================ */
const express   = require('express');
const router    = express.Router();
const asset     = require('../controllers/asset.controller');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth.middleware');
const { uploadAsset } = require('../config/cloudinary');
const { uploadLimiter } = require('../middleware/rateLimit.middleware');

router.get('/',            asset.getAssets);
router.get('/:id',         asset.getAsset);
router.post('/upload',     protect, adminOnly, uploadLimiter, uploadAsset.single('file'), asset.uploadAsset);
router.post('/:id/download', optionalAuth, asset.downloadAsset);
router.delete('/:id',      protect, adminOnly, asset.deleteAsset);

module.exports = router;
