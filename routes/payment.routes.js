
/* ============================================================
   FILE: routes/payment.routes.js
   ============================================================ */
const express  = require('express');
const router   = express.Router();
const payment  = require('../controllers/payment.controller');
const { protect, adminOnly } = require('../middleware/auth.middleware');
const { paymentLimiter }     = require('../middleware/rateLimit.middleware');

router.use(protect);
router.post('/create-order',       paymentLimiter, payment.createRazorpayOrder);
router.post('/verify',             paymentLimiter, payment.verifyPayment);
router.get('/history',             payment.getPaymentHistory);
router.post('/refund/:orderId',    adminOnly, payment.initiateRefund);

module.exports = router;