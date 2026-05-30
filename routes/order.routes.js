/* ============================================================
   FILE: routes/order.routes.js
   PADDOX — ORDER ROUTES
   Important: admin routes must be ABOVE /:id routes
   ============================================================ */

const express = require('express');
const router  = express.Router();

const order = require('../controllers/order.controller');

const {
  protect,
  adminOnly
} = require('../middleware/auth.middleware');

router.use(protect);

/* User order routes */
router.post('/', order.placeOrder);
router.get('/', order.getMyOrders);

/* Admin order routes must come before /:id */
router.get('/admin/all', adminOnly, order.getAllOrders);
router.get('/admin/:id', adminOnly, order.adminGetOrder);
router.put('/admin/:id/status', adminOnly, order.updateOrderStatus);
router.delete('/admin/:id', adminOnly, order.deleteOrder);

/* Dynamic user routes */
router.get('/:id', order.getOrder);
router.get('/:id/track', order.trackOrder);
router.put('/:id/cancel', order.cancelOrder);

module.exports = router;
