
/* ============================================================
   FILE: sockets/fanFeed.socket.js  —  Live Fan Feed Events
   ============================================================ */
const FanPost = require('../models/FanPost');

const initFanFeedSocket = (io) => {
  io.on('connection', (socket) => {

    /* Send last 10 posts on connect */
    FanPost.find({ isApproved:true, isFlagged:false })
      .sort('-createdAt').limit(10)
      .populate('user','firstName avatar')
      .then(posts => {
        socket.emit('fan:feed-history', posts.map(p => ({
          user  : p.user?.firstName || 'Fan',
          text  : p.text,
          time  : p.createdAt,
          avatar: p.user?.avatar?.url || '👤',
        })));
      }).catch(() => {});
  });
};

module.exports = { initFanFeedSocket };
