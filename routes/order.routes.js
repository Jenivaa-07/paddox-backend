/* ============================================================
   FILE: routes/order.routes.js
   ============================================================ */
const express = require('express');
const router  = express.Router();
const order   = require('../controllers/order.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);

router.post('/', order.placeOrder);

// Admin dashboard routes must come BEFORE /:id.
// For this project/demo, any logged-in user can read the admin list.
router.get('/admin/all', order.getAllOrders);
router.put('/admin/:id/status', order.updateOrderStatus);

router.get('/', order.getMyOrders);
router.get('/:id', order.getOrder);
router.get('/:id/track', order.trackOrder);
router.put('/:id/cancel', order.cancelOrder);

module.exports = router;
