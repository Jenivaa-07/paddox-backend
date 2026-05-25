/* ============================================================
   FILE: routes/asset.routes.js
   ============================================================ */
const express = require('express');
const router = express.Router();

const assetController = require('../controllers/asset.controller');
const { uploadAsset } = require('../config/cloudinary');
const { optionalAuth } = require('../middleware/auth.middleware');

/* IMPORTANT: specific routes before /:id */
router.get('/', assetController.getAssets);
router.post('/upload', uploadAsset.single('asset'), assetController.uploadAsset);
router.post('/', uploadAsset.single('asset'), assetController.uploadAsset);

/* Download must use optionalAuth so logged-in users get download history */
router.post('/:id/download', optionalAuth, assetController.downloadAsset);
router.get('/:id/download', optionalAuth, assetController.downloadAsset);
router.get('/download/:id', optionalAuth, assetController.downloadAsset);

router.get('/:id', assetController.getAsset);
router.put('/:id', assetController.updateAsset);
router.delete('/:id', assetController.deleteAsset);

module.exports = router;
