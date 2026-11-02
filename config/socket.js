/* ============================================================
   PADDOX Socket.IO — authenticated, allow-listed realtime events
   ============================================================ */
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { registerCommunityChatSocket } = require('../sockets/communityChat.socket');

let io;

function socketCookie(header = '', name = '') {
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try { return decodeURIComponent(value); } catch { return value; }
  }
  return '';
}

async function isAdminSocket(socket) {
  if (!socket.user?.id) return false;
  const user = await User.findById(socket.user.id).select('role isBanned');
  return user?.role === 'admin' && !user?.isBanned;
}

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: [
        'http://127.0.0.1:5500',
        'http://localhost:5500',
        'https://paddox.vercel.app',
        'https://paddox.store',
        'https://www.paddox.store'
      ],
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token ||
      socketCookie(socket.request?.headers?.cookie, 'accessToken');

    if (!token) {
      socket.user = null;
      return next();
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      const user = await User.findById(decoded.id)
        .select('firstName lastName avatar role fanTier isBanned');

      if (!user || user.isBanned) {
        return next(new Error('Authentication required'));
      }

      socket.user = {
        id: String(user._id),
        role: user.role,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'PADDOX Fan',
        avatar: user.avatar?.url || '',
        fanTier: user.fanTier || 'Regular'
      };
      return next();
    } catch {
      return next(new Error('Invalid or expired socket session'));
    }
  });

  io.on('connection', socket => {
    console.log(`Socket connected: ${socket.id} (${socket.user?.id || 'guest'})`);

    if (socket.user?.id) socket.join(`user:${socket.user.id}`);
    registerCommunityChatSocket(io, socket);

    const requireAdmin = async () => {
      try { return await isAdminSocket(socket); } catch { return false; }
    };

    socket.on('admin:new-drop', async payload => {
      if (!(await requireAdmin())) return;
      const data = payload && typeof payload === 'object' ? payload : {};
      const kind = String(data.kind || data.type || 'product').toLowerCase();
      const eventName = kind.includes('asset') ? 'asset:new-drop' : 'product:new-drop';
      io.emit(eventName, {
        title: String(data.title || '').slice(0, 120),
        kind: eventName === 'asset:new-drop' ? 'asset' : 'product',
        createdAt: new Date().toISOString()
      });
    });

    socket.on('admin:race-alert', async payload => {
      if (!(await requireAdmin())) return;
      const data = payload && typeof payload === 'object' ? payload : {};
      io.emit('race:notification', {
        title: String(data.title || 'Race alert').slice(0, 120),
        message: String(data.message || 'A PADDOX race alert is live.').slice(0, 500),
        category: 'Race Alerts',
        createdAt: new Date().toISOString()
      });
    });

    socket.on('admin:community-update', async payload => {
      if (!(await requireAdmin())) return;
      const data = payload && typeof payload === 'object' ? payload : {};
      io.emit('community:notification', {
        title: String(data.title || 'Community update').slice(0, 120),
        message: String(data.message || 'New PADDOX community activity is live.').slice(0, 500),
        category: String(data.category || 'Fan Hub').slice(0, 60),
        createdAt: new Date().toISOString()
      });
    });

    // Only authenticated fans may join the single public fan room.
    socket.on('fan:join-room', payload => {
      if (!socket.user?.id) return socket.emit('error', { message: 'Authentication required' });
      const room = String(payload?.room || '');
      if (room !== 'fan:global') return socket.emit('error', { message: 'Room not allowed' });
      socket.join(room);
      socket.emit('fan:joined', { room });
    });

    socket.on('fan:leave-room', payload => {
      const room = String(payload?.room || '');
      if (room === 'fan:global') socket.leave(room);
    });

    socket.on('fan:post', payload => {
      if (!socket.user?.id) return socket.emit('error', { message: 'Authentication required to post' });
      const message = String(payload?.text || '').trim();
      if (!message || message.length > 280) {
        return socket.emit('error', { message: 'Post must contain 1–280 characters' });
      }
      io.to('fan:global').emit('fan:new-post', {
        user: socket.user.name,
        text: message,
        time: 'Just now',
        userId: socket.user.id,
        avatar: socket.user.avatar || '👤'
      });
    });

    // Poll results are authoritative through the REST API, never client-broadcast.
    socket.on('poll:vote', () => {
      socket.emit('error', { message: 'Submit votes through the PADDOX poll API' });
    });

    // Race rooms are read-only and accept a constrained session key.
    socket.on('race:join', payload => {
      const sessionKey = String(payload?.sessionKey || '');
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(sessionKey)) {
        return socket.emit('error', { message: 'Invalid race session' });
      }
      socket.join(`race:${sessionKey}`);
    });

    socket.on('disconnect', reason => {
      console.log(`Socket disconnected: ${socket.id} (${reason})`);
    });
  });

  console.log('PADDOX Socket.IO initialised');
  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialised');
  return io;
};

module.exports = { initSocket, getIO };
