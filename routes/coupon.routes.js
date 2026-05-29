/* ============================================================
   FILE: routes/coupon.routes.js
   PADDOX — Coupon Routes
   ============================================================ */
const express = require('express');
const router = express.Router();
const coupon = require('../controllers/coupon.controller');
const { protect, adminOnly } = require('../middleware/auth.middleware');

/* Public checkout validation */
router.post('/validate', coupon.validateCoupon);

/* Admin coupon management */
router.get('/admin', protect, adminOnly, coupon.getAdminCoupons);
router.post('/admin', protect, adminOnly, coupon.createCoupon);
router.put('/admin/:id', protect, adminOnly, coupon.updateCoupon);
router.delete('/admin/:id', protect, adminOnly, coupon.deleteCoupon);

module.exports = router;
