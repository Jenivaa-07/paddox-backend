/* ============================================================
   FILE: routes/asset.routes.js
   ============================================================ */
const express = require('express');
const router = express.Router();

const asset = require('../controllers/asset.controller');
const { uploadAsset } = require('../config/cloudinary');
const { optionalAuth } = require('../middleware/auth.middleware');

/* Public routes */
router.get('/', asset.getAssets);
router.get('/category/:cat', asset.getByCategory);

/* Download route must come BEFORE get single */
router.post('/:id/download', optionalAuth, asset.downloadAsset);

/* Get single */
router.get('/:id', asset.getAsset);

/* Upload */
router.post('/upload', uploadAsset.single('asset'), asset.uploadAsset);

/* Delete */
router.delete('/:id', asset.deleteAsset);

module.exports = router;