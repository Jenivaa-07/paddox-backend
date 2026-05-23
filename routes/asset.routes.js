/* ============================================================
   FILE: routes/asset.routes.js
   ============================================================ */
const express = require('express');

const router = express.Router();

const assetController = require('../controllers/asset.controller');

const { uploadAsset } = require('../config/cloudinary');

/* GET ALL */
router.get('/', assetController.getAssets);

/* GET SINGLE */
router.get('/:id', assetController.getAsset);

/* DOWNLOAD */
router.get('/download/:id', assetController.downloadAsset);

/* UPLOAD */
router.post(
  '/upload',
  uploadAsset.single('asset'),
  assetController.uploadAsset
);

/* DELETE */
router.delete('/:id', assetController.deleteAsset);

module.exports = router;