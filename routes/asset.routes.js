/* ============================================================
   FILE: routes/asset.routes.js
   PADDOX — Digital Assets Routes
   Phase A4.7A.2
   ============================================================ */
const express = require('express');
const router = express.Router();

const assetController = require('../controllers/asset.controller');
const { uploadAsset } = require('../config/cloudinary');
const { protect, adminOnly } = require('../middleware/auth.middleware');

const assetUploadFields = uploadAsset.fields([
  { name: 'asset', maxCount: 1 },
  { name: 'desktop', maxCount: 1 },
  { name: 'mobile', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]);

/* Public listing */
router.get('/', assetController.getAssets);

/* Premium purchase / unlock. */
router.post('/:id/purchase', protect, assetController.purchaseAsset);

/* Login required for every download, including free wallpapers.
   Keep these before /:id so Express does not treat download as an id. */
router.post('/:id/download', protect, assetController.downloadAsset);
router.get('/:id/download', protect, assetController.downloadAsset);
router.get('/download/:id', protect, assetController.downloadAsset);

router.get('/:id', assetController.getAsset);

/* Admin asset management */
router.post('/upload', protect, adminOnly, assetUploadFields, assetController.uploadAsset);
router.post('/', protect, adminOnly, assetUploadFields, assetController.uploadAsset);
router.put('/:id', protect, adminOnly, assetUploadFields, assetController.updateAsset);
router.delete('/:id', protect, adminOnly, assetController.deleteAsset);

module.exports = router;
