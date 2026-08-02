
/* ============================================================
   FILE: routes/cart.routes.js
   ============================================================ */
const express = require('express');
const router  = express.Router();
const cart    = require('../controllers/cart.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);
router.get('/',                 cart.getCart);
router.post('/add',             cart.addToCart);
router.put('/update',           cart.updateCart);
router.delete('/remove/:productId', cart.removeFromCart);
router.delete('/clear',         cart.clearCart);

module.exports = router;

