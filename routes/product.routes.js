/* ============================================================
   FILE: routes/product.routes.js
   PADDOX — PRODUCT ROUTES
   Phase A4.1.2: multipart admin product image upload.
   ============================================================ */

const express = require('express');
const multer = require('multer');

const router = express.Router();

const productController = require('../controllers/product.controller');
const { protect, adminOnly } = require('../middleware/auth.middleware');

let productUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 8 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  }
});

try {
  const cloudinaryConfig = require('../config/cloudinary');
  if (cloudinaryConfig.upload?.array) {
    productUpload = cloudinaryConfig.upload;
  }
} catch (err) {
  console.warn('Using memory upload fallback for products:', err.message);
}

const productImages = productUpload.array('images', 10);

/* GET ALL */
router.get('/', productController.getProducts);

/* GET SINGLE */
router.get('/:id', productController.getProduct);

/* CREATE — admin only, uploads up to 10 images */
router.post('/', protect, adminOnly, productImages, productController.createProduct);

/* UPDATE — admin only, supports replacing product images */
router.put('/:id', protect, adminOnly, productImages, productController.updateProduct);

/* DELETE — admin only */
router.delete('/:id', protect, adminOnly, productController.deleteProduct);

module.exports = router;
