
/* ============================================================
   FILE: sockets/liveRace.socket.js  —  Live Race Broadcast
   ============================================================ */
const { getOpenF1Position, getOpenF1Laps } = require('../utils/f1Api');

const initLiveRaceSocket = (io) => {
  let raceInterval = null;

  const startBroadcast = (sessionKey) => {
    if (raceInterval) clearInterval(raceInterval);
    raceInterval = setInterval(async () => {
      try {
        const [positions, laps] = await Promise.all([
          getOpenF1Position({ session_key:sessionKey }),
          getOpenF1Laps({ session_key:sessionKey }),
        ]);
        io.to(`race:${sessionKey}`).emit('race:lap-update', {
          positions : positions.data?.slice(0,20) || [],
          latestLaps: laps.data?.slice(-20) || [],
          timestamp : new Date().toISOString(),
        });
      } catch { /* API error — skip tick */ }
    }, 5000); // every 5 seconds
  };

  io.on('connection', (socket) => {
    socket.on('race:start-broadcast', ({ sessionKey }) => {
      if (socket.user?.role !== 'admin') return;
      startBroadcast(sessionKey);
      socket.emit('race:broadcast-started', { sessionKey });
    });
    socket.on('race:stop-broadcast', () => {
      if (socket.user?.role !== 'admin') return;
      if (raceInterval) { clearInterval(raceInterval); raceInterval = null; }
    });
  });
};

module.exports = { initLiveRaceSocket };

