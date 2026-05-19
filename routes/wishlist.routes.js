
/* ============================================================
   FILE: routes/wishlist.routes.js
   ============================================================ */
const express   = require('express');
const router    = express.Router();
const wishlist  = require('../controllers/wishlist.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);
router.get('/',                     wishlist.getWishlist);
router.post('/add/:productId',      wishlist.addToWishlist);
router.delete('/remove/:productId', wishlist.removeFromWishlist);
router.delete('/clear',             wishlist.clearWishlist);

module.exports = router;

