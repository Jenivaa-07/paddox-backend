
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
//const mongoSanitize= require('express-mongo-sanitize');
const hpp          = require('hpp');
const rateLimit    = require('express-rate-limit');
const dotenv       = require('dotenv');
const path         = require('path');

/* ── Load env ── */
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.resolve(__dirname, envFile) });

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
  'https://paddox.vercel.app'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Paddox-Session-Id'],
  exposedHeaders: ['X-Paddox-Session-Id'],
};

/* ── Middleware Stack ── */
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
//app.use(mongoSanitize());
app.use(hpp());
app.use(globalLimiter);

/* ── Health Check ── */
app.get('/health', (req, res) => {
  res.json({
    success : true,
    message : '🏎️ Paddox API is running',
    version : '1.0.0',
    env     : process.env.NODE_ENV,
    time    : new Date().toISOString(),
  });
});

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