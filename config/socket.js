
/* ============================================================
   FILE: config/socket.js  —  WebSocket (Socket.io) Setup
   ============================================================ */
// config/socket.js
const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const User       = require('../models/User');
const { registerCommunityChatSocket } = require('../sockets/communityChat.socket');

let io;

async function isAdminSocket(socket) {
  try {
    if (!socket.user?.id) return false;
    if (socket.user?.role === 'admin') return true;
    const user = await User.findById(socket.user.id).select('role');
    return user?.role === 'admin';
  } catch {
    return false;
  }
}

function socketCookie(header = '', name = '') {
  const parts = String(header || '').split(';');
  for (const part of parts) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); }
    catch { return part.slice(index + 1).trim(); }
  }
  return '';
}

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: [
        'http://127.0.0.1:5500',
        'http://localhost:5500',
        'https://paddox.vercel.app'
      ],
      methods    : ['GET','POST'],
      credentials: true,
    },
    pingTimeout  : 60000,
    pingInterval : 25000,
  });

  /* ── Auth middleware for socket ── */
  io.use(async (socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      socketCookie(socket.request?.headers?.cookie, 'accessToken');

    if (!token) {
      /* Public socket access remains available for feed/chat viewing. */
      socket.user = null;
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      const user = await User.findById(decoded.id)
        .select('firstName lastName avatar role fanTier isBanned');

      if (!user || user.isBanned) {
        socket.user = null;
        return next();
      }

      socket.user = {
        id:String(user._id),
        role:user.role,
        name:`${user.firstName || ''} ${user.lastName || ''}`.trim() || 'PADDOX Fan',
        avatar:user.avatar?.url || '',
        fanTier:user.fanTier || 'Regular'
      };
      return next();
    } catch {
      socket.user = null;
      return next();
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user?.id || 'anonymous';
    console.log(`🔌 Socket connected: ${socket.id} (user: ${userId})`);

    /* Join user-specific room */
    if (socket.user?.id) {
      socket.join(`user:${socket.user.id}`);
    }

    /* Fan Hub Live Grid chat: presence + typing */
    registerCommunityChatSocket(io, socket);

    /* ── Admin notification relays ── */
    socket.on('admin:new-drop', async (payload = {}) => {
      if (!(await isAdminSocket(socket))) return;
      const kind = String(payload.kind || payload.type || 'product').toLowerCase();
      const eventName = kind.includes('asset') ? 'asset:new-drop' : 'product:new-drop';
      io.emit(eventName, {
        ...payload,
        kind,
        createdAt: payload.createdAt || new Date().toISOString()
      });
    });

    socket.on('admin:race-alert', async (payload = {}) => {
      if (!(await isAdminSocket(socket))) return;
      io.emit('race:notification', {
        title: payload.title || 'Race alert',
        message: payload.message || 'A PADDOX race alert is live.',
        category: 'Race Alerts',
        ref: payload.ref || payload.title || Date.now(),
        createdAt: payload.createdAt || new Date().toISOString()
      });
    });

    socket.on('admin:community-update', async (payload = {}) => {
      if (!(await isAdminSocket(socket))) return;
      io.emit('community:notification', {
        title: payload.title || 'Community update',
        message: payload.message || 'New PADDOX community activity is live.',
        category: payload.category || 'Fan Hub',
        ref: payload.ref || payload.title || Date.now(),
        createdAt: payload.createdAt || new Date().toISOString()
      });
    });

    /* ── Fan Feed events ── */
    socket.on('fan:join-room', ({ room }) => {
      socket.join(room);
      socket.emit('fan:joined', { room, message: `Joined room: ${room}` });
    });

    socket.on('fan:leave-room', ({ room }) => {
      socket.leave(room);
    });

    socket.on('fan:post', async (data) => {
      if (!socket.user) {
        return socket.emit('error', { message: 'Authentication required to post' });
      }
      const post = {
        user    : socket.user.name || 'Fan',
        text    : data.text?.slice(0, 280),
        time    : 'Just now',
        userId  : socket.user.id,
        avatar  : socket.user.avatar || '👤',
      };
      io.emit('fan:new-post', post);
    });

    /* ── Poll vote broadcast ── */
    socket.on('poll:vote', (data) => {
      io.emit('poll:vote-update', data);
    });

    /* ── Race room ── */
    socket.on('race:join', ({ sessionKey }) => {
      socket.join(`race:${sessionKey}`);
      console.log(`🏎️  Socket ${socket.id} joined race room: ${sessionKey}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`🔌 Socket disconnected: ${socket.id} (${reason})`);
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err);
    });
  });

  console.log('✅ WebSocket server initialised');
  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialised');
  return io;
};

module.exports = { initSocket, getIO };

