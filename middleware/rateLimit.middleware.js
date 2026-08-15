
/* ============================================================
   FILE: middleware/rateLimit.middleware.js  —  Route Rate Limits
   ============================================================ */
// middleware/rateLimit.middleware.js
const rateLimit = require('express-rate-limit');

/* Strict limiter for auth routes */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max     : 10,
  message : { success:false, message:'Too many auth attempts. Try again in 15 minutes.' },
});

/* Payment route limiter */
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 min
  max     : 5,
  message : { success:false, message:'Too many payment requests. Slow down.' },
});

/* F1 API proxy limiter */
const f1Limiter = rateLimit({
  windowMs: 60 * 1000,  // 1 min
  max     : 30,
  message : { success:false, message:'F1 API rate limit exceeded.' },
});

/* Upload limiter */
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max     : 20,
  message : { success:false, message:'Upload limit exceeded. Try again later.' },
});

/* Grounded chat limiter — protects the AI service from prompt flooding */
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success:false, message:'AI Pit Wall rate limit reached. Try again in a minute.' },
});

/* Fan Hub Live Grid Chat — prevents rapid message/reaction spam. */
const communityChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 35,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success:false, message:'Live Grid chat is moving fast. Slow down for a moment.' },
});

module.exports = {
  authLimiter,
  paymentLimiter,
  f1Limiter,
  uploadLimiter,
  chatLimiter,
  communityChatLimiter
};
