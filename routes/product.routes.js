/* ============================================================
   FILE: routes/product.routes.js
   PADDOX — PRODUCT ROUTES
   Phase A4.7B.5: Boot-safe product routes + stock endpoints
   Fixes Render deploy crash: "argument handler must be a function"
   ============================================================ */

const express = require('express');
const multer = require('multer');

const router = express.Router();

const productController = require('../controllers/product.controller') || {};
const productAdminController = require('../controllers/product-admin.controller') || {};
const authMiddleware = require('../middleware/auth.middleware') || {};
const { importRemoteProductImages } = require('../middleware/productRemoteImages.middleware');

const protect =
  typeof authMiddleware.protect === 'function'
    ? authMiddleware.protect
    : (req, res) => res.status(503).json({ success:false, message:'Authentication middleware is unavailable' });

const adminOnly =
  typeof authMiddleware.adminOnly === 'function'
    ? authMiddleware.adminOnly
    : (req, res) => res.status(503).json({ success:false, message:'Admin authorization middleware is unavailable' });

function missingHandler(name) {
  return (req, res) => res.status(501).json({
    success: false,
    message: `Product controller handler missing: ${name}`
  });
}

function h(name, fallback) {
  if (typeof productController[name] === 'function') return productController[name];
  if (typeof fallback === 'function') return fallback;
  return missingHandler(name);
}

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

/* Public product routes */
router.get('/', h('getProducts'));

/* Dedicated protected Admin catalogue — keep ABOVE /:id */
router.get(
  '/admin/all',
  protect,
  adminOnly,
  typeof productAdminController.getAdminProducts === 'function'
    ? productAdminController.getAdminProducts
    : missingHandler('getAdminProducts')
);

/* Admin stock/inventory helpers — keep ABOVE /:id routes */
router.post('/admin/restock-low', protect, adminOnly, h('bulkRestockLowStock', productController.restockLowStock));
router.post('/restock-low', protect, adminOnly, h('bulkRestockLowStock', productController.restockLowStock));
router.patch('/admin/:id/stock', protect, adminOnly, h('updateStock', productController.updateProductStock));
router.patch('/:id/stock', protect, adminOnly, h('updateStock', productController.updateProductStock));
router.patch('/:id/inventory', protect, adminOnly, h('updateStock', productController.updateProductStock));
router.patch('/:id/restock', protect, adminOnly, h('restockProduct', productController.updateStock));
router.patch('/:id/mark-out', protect, adminOnly, h('markOutOfStock', productController.updateStock));

/* Reviews — keep ABOVE /:id if present */
router.get('/:id/reviews', h('getReviews'));
router.post('/:id/reviews', protect, h('addReview'));

/* Single product */
router.get('/:id', h('getProduct'));

/* Create / update / delete — admin only */
router.post('/', protect, adminOnly, productImages, importRemoteProductImages, h('createProduct'));
router.put('/:id', protect, adminOnly, productImages, importRemoteProductImages, h('updateProduct'));
router.delete('/:id', protect, adminOnly, h('deleteProduct'));

module.exports = router;
