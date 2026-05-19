
/* ============================================================
   FILE: config/socket.js  —  WebSocket (Socket.io) Setup
   ============================================================ */
// config/socket.js
const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin     : process.env.SOCKET_CORS_ORIGIN || 'http://127.0.0.1:5500',
      methods    : ['GET','POST'],
      credentials: true,
    },
    pingTimeout  : 60000,
    pingInterval : 25000,
  });

  /* ── Auth middleware for socket ── */
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      /* Allow unauthenticated for public feed */
      socket.user = null;
      return next();
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      socket.user   = decoded;
      next();
    } catch {
      socket.user = null;
      next();
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user?.id || 'anonymous';
    console.log(`🔌 Socket connected: ${socket.id} (user: ${userId})`);

    /* Join user-specific room */
    if (socket.user?.id) {
      socket.join(`user:${socket.user.id}`);
    }

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
        text    : data.text?.slice(0, 280), // max 280 chars
        time    : 'Just now',
        userId  : socket.user.id,
        avatar  : socket.user.avatar || '👤',
      };
      /* Broadcast to all connected clients */
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

