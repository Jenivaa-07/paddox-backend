const express = require('express');
const { optionalAuth } = require('../middleware/auth.middleware');
const { chatLimiter } = require('../middleware/rateLimit.middleware');
const chat = require('../controllers/chat.controller');

const router = express.Router();

router.post(
  '/',
  chatLimiter,
  optionalAuth,
  chat.ask
);

module.exports = router;
