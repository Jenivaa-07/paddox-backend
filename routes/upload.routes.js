/* ============================================================
   FILE: routes/upload.routes.js
   PADDOX — GENERIC CLOUDINARY IMAGE UPLOAD ROUTES
   Mount in server.js/app.js:
   app.use('/api/uploads', require('./routes/upload.routes'));
   ============================================================ */

const express = require('express');
const multer = require('multer');

const router = express.Router();
const uploadController = require('../controllers/upload.controller');
const { protect } = require('../middleware/auth.middleware');

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }

    cb(null, true);
  }
});

router.post('/image', protect, imageUpload.single('image'), uploadController.uploadImage);

module.exports = router;
