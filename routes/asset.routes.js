/* ============================================================
   FILE: routes/asset.routes.js
   PADDOX — Digital Asset Routes
   Phase A4.7A: Admin-protected uploads + login-required downloads
   ============================================================ */
const express = require('express');
const router = express.Router();

const assetController = require('../controllers/asset.controller');
const { uploadAsset } = require('../config/cloudinary');
const { protect, adminOnly } = require('../middleware/auth.middleware');

const assetUploadFields = uploadAsset.fields([
  { name: 'asset', maxCount: 1 },
  { name: 'desktopAsset', maxCount: 1 },
  { name: 'mobileAsset', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]);

/* Public listing and preview */
router.get('/', assetController.getAssets);
router.get('/:id', assetController.getAsset);

/* Admin asset management */
router.post('/upload', protect, adminOnly, assetUploadFields, assetController.uploadAsset);
router.post('/', protect, adminOnly, assetUploadFields, assetController.uploadAsset);
router.put('/:id', protect, adminOnly, assetController.updateAsset);
router.delete('/:id', protect, adminOnly, assetController.deleteAsset);

/* Downloads require login even for free wallpapers */
router.post('/:id/download', protect, assetController.downloadAsset);
router.get('/:id/download', protect, assetController.downloadAsset);
router.get('/download/:id', protect, assetController.downloadAsset);

module.exports = router;
