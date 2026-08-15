const express = require('express');
const router = express.Router();
const collection = require('../controllers/collection.controller');
const { protect } = require('../middleware/auth.middleware');

router.get('/me', protect, collection.getMyCollection);
router.post('/:code/share', protect, collection.shareCollectible);

module.exports = router;
