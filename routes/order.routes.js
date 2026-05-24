
/* ============================================================
   FILE: routes/order.routes.js
   ============================================================ */
const express = require('express');
const router  = express.Router();
const order   = require('../controllers/order.controller');
const { protect, adminOnly } = require('../middleware/auth.middleware');

router.use(protect);
router.post('/',               order.placeOrder);
router.get('/',                order.getMyOrders);
router.get('/admin/all',        adminOnly, order.getAllOrders);
router.put('/admin/:id/status', adminOnly, order.updateOrderStatus);

router.get('/:id',        order.getOrder);
router.get('/:id/track',  order.trackOrder);
router.put('/:id/cancel', order.cancelOrder);

module.exports = router;
