
/* ============================================================
   FILE: server.js  —  Paddox Backend Entry Point
   ============================================================ */
const express      = require('express');
const http         = require('http');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const compression  = require('compression');
const cookieParser = require('cookie-parser');
const mongoSanitize= require('express-mongo-sanitize');
const hpp          = require('hpp');
const rateLimit    = require('express-rate-limit');
const dotenv       = require('dotenv');
const path         = require('path');
const { randomUUID } = require('crypto');
const { validateCsrf, issueCsrfToken } = require('./middleware/csrf.middleware');

/* ── Load env ── */
try {
  const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
  dotenv.config({ path: path.resolve(__dirname, envFile) });
} catch (e) {
  console.log('Env loaded natively by runtime');
}

const connectDB  = require('./config/db');
const { initSocket } = require('./config/socket');
const errorMiddleware = require('./middleware/error.middleware');

/* ── Routes ── */
const authRoutes     = require('./routes/auth.routes');
const userRoutes     = require('./routes/user.routes');
const productRoutes  = require('./routes/product.routes');
const orderRoutes    = require('./routes/order.routes');
const cartRoutes     = require('./routes/cart.routes');
const wishlistRoutes = require('./routes/wishlist.routes');
const paymentRoutes  = require('./routes/payment.routes');
const f1Routes       = require('./routes/f1.routes');
const assetRoutes    = require('./routes/asset.routes');
const adminRoutes    = require('./routes/admin.routes');
const fanRoutes      = require('./routes/fan.routes');
const couponRoutes   = require('./routes/coupon.routes');
const uploadRoutes   = require('./routes/upload.routes');
const voiceRoutes    = require('./routes/voice.routes');
const collectibleRoutes = require('./routes/collectible.routes');
// NOTE: AI Prompt Studio has been permanently removed. Routes, controller and
// frontend files deleted. GET /api/ai-studio returns standard 404.

/* ── Connect DB ── */
connectDB();

const app    = express();
const server = http.createServer(app);

/* ── Init WebSocket ── */
initSocket(server);

/* ── Global Rate Limiter ── */
const globalLimiter = rateLimit({
  windowMs : 15 * 60 * 1000,  // 15 minutes
  max      : 200,
  message  : { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders  : false,
});

/* ── CORS ── */
const allowedOrigins = [
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://localhost:5173',
  'https://paddox.vercel.app'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Paddox-Session-Id'],
  exposedHeaders: ['X-Paddox-Session-Id'],
};

/* ── Request ID Middleware ── */
const requestIdMiddleware = (req, res, next) => {
  const id = req.headers['x-request-id'] || randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
};

/* ── Middleware Stack ── */
app.use(requestIdMiddleware);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ key }) => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[SECURITY] mongo-sanitize removed key "${key}" from request`);
    }
  }
}));
// Fix for Node 24 req.query getter issue by redefining query property if needed
app.use((req, res, next) => {
  if (req.query) {
    try {
      const sanitized = JSON.parse(JSON.stringify(req.query).replace(/\$/g, '_'));
      Object.defineProperty(req, 'query', { value: sanitized, writable: true, configurable: true });
    } catch (e) {}
  }
  next();
});
app.use(hpp());
app.use(globalLimiter);
app.use(validateCsrf);

/* ── Health & Readiness Checks ── */
app.get('/health', (req, res) => {
  res.json({
    success : true,
    message : '🏎️ Paddox API is running',
    version : '1.0.0',
    env     : process.env.NODE_ENV,
    time    : new Date().toISOString(),
  });
});
app.get('/ready', (req, res) => {
  const isDbReady = require('mongoose').connection.readyState === 1;
  if (isDbReady) return res.json({ success: true, message: 'Ready' });
  res.status(503).json({ success: false, message: 'Database not ready' });
});

/* ── CSRF Token Endpoint ── */
app.get('/api/auth/csrf-token', issueCsrfToken);

/* ── API Routes ── */
const API = '/api';
app.use(`${API}/auth`,     authRoutes);
app.use(`${API}/users`,    userRoutes);
app.use(`${API}/products`, productRoutes);
app.use(`${API}/orders`,   orderRoutes);
app.use(`${API}/cart`,     cartRoutes);
app.use(`${API}/wishlist`, wishlistRoutes);
app.use(`${API}/payments`, paymentRoutes);
app.use(`${API}/f1`,       f1Routes);
app.use(`${API}/assets`,   assetRoutes);
app.use(`${API}/admin`,    adminRoutes);
app.use(`${API}/fan`,      fanRoutes);
app.use(`${API}/coupons`,  couponRoutes);
app.use(`${API}/uploads`,  uploadRoutes);
app.use(`${API}/voice`,    voiceRoutes);
app.use(`${API}/collectibles`, collectibleRoutes);

/* ── 404 Handler ── */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found on this server`,
  });
});

/* ── Global Error Handler ── */
app.use(errorMiddleware);

/* ── Start Server ── */
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log('\n🏎️  ================================');
  console.log(`    PADDOX API running on port ${PORT}`);
  console.log(`    ENV  : ${process.env.NODE_ENV}`);
  console.log(`    URL  : http://localhost:${PORT}`);
  console.log('    ================================\n');
});

/* ── Graceful Shutdown ── */
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err.message);
  server.close(() => process.exit(1));
});
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully…');
  server.close(() => process.exit(0));
});

module.exports = { app, server };