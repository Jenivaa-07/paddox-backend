/* ============================================================
   FILE: routes/asset.routes.js
   ============================================================ */
const express = require('express');
const router = express.Router();

const assetController = require('../controllers/asset.controller');
const { uploadAsset } = require('../config/cloudinary');

/* IMPORTANT: specific routes before /:id */
router.get('/', assetController.getAssets);
router.post('/upload', uploadAsset.single('asset'), assetController.uploadAsset);
router.post('/', uploadAsset.single('asset'), assetController.uploadAsset);
router.get('/:id/download', assetController.downloadAsset);
router.get('/download/:id', assetController.downloadAsset);
router.get('/:id', assetController.getAsset);
router.delete('/:id', assetController.deleteAsset);

module.exports = router;
