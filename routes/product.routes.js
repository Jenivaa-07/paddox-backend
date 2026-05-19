
/* ============================================================
   FILE: routes/product.routes.js
   ============================================================ */
const express = require('express');
const router  = express.Router();
const product = require('../controllers/product.controller');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth.middleware');
const { uploadProduct } = require('../config/cloudinary');

router.get('/',          optionalAuth, product.getProducts);
router.get('/:id',       optionalAuth, product.getProduct);
router.post('/',         protect, adminOnly, uploadProduct.array('images', 6), product.createProduct);
router.put('/:id',       protect, adminOnly, product.updateProduct);
router.delete('/:id',    protect, adminOnly, product.deleteProduct);
router.post('/:id/review', protect, product.addReview);
router.get('/:id/reviews', product.getReviews);

module.exports = router;