const express = require('express');
const router = express.Router();
const fantasy = require('../controllers/fantasy.controller');
const { protect } = require('../middleware/auth.middleware');
const { f1Limiter } = require('../middleware/rateLimit.middleware');

router.get('/next-race', f1Limiter, protect, fantasy.getNextRacePrediction);

module.exports = router;
