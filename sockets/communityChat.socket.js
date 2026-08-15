/* ============================================================
   PADDOX — Fan Hub Live Grid Chat Socket Events
   Presence + typing. Persistent message writes stay on REST routes.
   ============================================================ */
const ROOM = 'community:global';
const activeUsers = new Map();

function addPresence(socket) {
  const userId = socket.user?.id;
  if (!userId) return;
  if (!activeUsers.has(userId)) activeUsers.set(userId, new Set());
  activeUsers.get(userId).add(socket.id);
}

function removePresence(socket) {
  const userId = socket.user?.id;
  if (!userId || !activeUsers.has(userId)) return;
  const sockets = activeUsers.get(userId);
  sockets.delete(socket.id);
  if (!sockets.size) activeUsers.delete(userId);
}

function presencePayload() {
  return { online:activeUsers.size, room:'global', updatedAt:new Date().toISOString() };
}

function registerCommunityChatSocket(io, socket) {
  socket.on('chat:join', () => {
    socket.join(ROOM);
    socket.data.paddoxChatJoined = true;
    addPresence(socket);
    io.to(ROOM).emit('chat:presence', presencePayload());
    socket.emit('chat:joined', {
      room:'global',
      authenticated:!!socket.user?.id,
      user:socket.user || null,
      ...presencePayload()
    });
  });

  socket.on('chat:leave', () => {
    socket.leave(ROOM);
    socket.data.paddoxChatJoined = false;
    removePresence(socket);
    io.to(ROOM).emit('chat:presence', presencePayload());
  });

  socket.on('chat:typing', (payload = {}) => {
    if (!socket.user?.id || !socket.data.paddoxChatJoined) return;
    socket.to(ROOM).emit('chat:typing', {
      user:{
        id:socket.user.id,
        name:socket.user.name || 'PADDOX Fan',
        avatar:socket.user.avatar || '',
        fanTier:socket.user.fanTier || 'Regular'
      },
      isTyping:!!payload.isTyping
    });
  });

  socket.on('disconnect', () => {
    if (!socket.data.paddoxChatJoined) return;
    removePresence(socket);
    io.to(ROOM).emit('chat:presence', presencePayload());
  });
}

module.exports = { registerCommunityChatSocket };
