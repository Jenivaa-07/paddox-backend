/* ============================================================
   PADDOX — Fan Hub Live Grid Chat Controller
   Persistent history + replies + reactions + moderation hooks.
   ============================================================ */
const mongoose = require('mongoose');
const ChatMessage = require('../models/ChatMessage');
const { getIO } = require('../config/socket');

const ROOM = 'global';
const SOCKET_ROOM = 'community:global';
const ALLOWED_REACTIONS = new Set(['❤️','🔥','😂','🏁','👍']);

function userIdOf(value) {
  if (!value) return '';
  return String(value._id || value.id || value);
}

function publicUser(user = {}) {
  const id = userIdOf(user);
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.name || 'PADDOX Fan';
  return {
    id,
    name,
    avatar: user.avatar?.url || user.avatar || '',
    fanTier: user.fanTier || 'Regular',
    role: user.role || 'user'
  };
}

function reactionSummary(reactions = [], viewerId = '') {
  return reactions.map(reaction => {
    const ids = (reaction.users || []).map(userIdOf);
    return {
      emoji: reaction.emoji,
      count: ids.length,
      reactedByMe: !!viewerId && ids.includes(String(viewerId))
    };
  }).filter(item => item.count > 0);
}

function serializeReply(reply = null) {
  if (!reply) return null;
  return {
    id: userIdOf(reply),
    text: reply.isDeleted ? 'Message deleted' : String(reply.text || '').slice(0, 180),
    user: publicUser(reply.user || {}),
    isDeleted: !!reply.isDeleted
  };
}

function serializeMessage(message, viewer = null) {
  const raw = message?.toObject ? message.toObject() : message || {};
  const viewerId = userIdOf(viewer);
  const ownerId = userIdOf(raw.user);
  return {
    id: userIdOf(raw),
    room: raw.room || ROOM,
    text: raw.isDeleted ? '' : raw.text || '',
    user: publicUser(raw.user || {}),
    replyTo: serializeReply(raw.replyTo),
    reactions: reactionSummary(raw.reactions || [], viewerId),
    isDeleted: !!raw.isDeleted,
    isFlagged: !!raw.isFlagged,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    canDelete: !!viewerId && (viewerId === ownerId || viewer?.role === 'admin')
  };
}

function sanitizeText(value = '') {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s{4,}/g, '   ')
    .trim()
    .slice(0, 500);
}

function safeEmit(event, payload) {
  try {
    getIO().to(SOCKET_ROOM).emit(event, payload);
  } catch (err) {
    console.warn(`PADDOX chat socket emit skipped (${event}):`, err.message);
  }
}

function messageQueryById(id) {
  return ChatMessage.findById(id)
    .populate('user', 'firstName lastName avatar fanTier role')
    .populate({
      path:'replyTo',
      select:'text user isDeleted createdAt',
      populate:{ path:'user', select:'firstName lastName avatar fanTier role' }
    });
}

exports.getMessages = async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(10, Number(req.query.limit || 35)));
    const query = { room:ROOM };

    if (req.query.before) {
      const before = new Date(req.query.before);
      if (!Number.isNaN(before.getTime())) query.createdAt = { $lt:before };
    }

    const rows = await ChatMessage.find(query)
      .sort({ createdAt:-1 })
      .limit(limit + 1)
      .populate('user', 'firstName lastName avatar fanTier role')
      .populate({
        path:'replyTo',
        select:'text user isDeleted createdAt',
        populate:{ path:'user', select:'firstName lastName avatar fanTier role' }
      });

    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit).reverse();

    res.json({
      success:true,
      data:{
        messages:visible.map(row => serializeMessage(row, req.user)),
        hasMore,
        nextBefore:visible.length ? visible[0].createdAt : null
      }
    });
  } catch (err) { next(err); }
};

exports.sendMessage = async (req, res, next) => {
  try {
    const text = sanitizeText(req.body.text);
    if (!text) return res.status(400).json({ success:false, message:'Write a message first.' });

    let replyTo = null;
    if (req.body.replyTo) {
      if (!mongoose.isValidObjectId(req.body.replyTo)) {
        return res.status(400).json({ success:false, message:'Invalid reply target.' });
      }
      const target = await ChatMessage.findOne({ _id:req.body.replyTo, room:ROOM, isDeleted:false }).select('_id');
      if (!target) return res.status(404).json({ success:false, message:'Reply target is no longer available.' });
      replyTo = target._id;
    }

    const created = await ChatMessage.create({ room:ROOM, user:req.user._id, text, replyTo });
    const populated = await messageQueryById(created._id);
    const payload = serializeMessage(populated, req.user);

    safeEmit('chat:new-message', { ...payload, canDelete:false });
    res.status(201).json({ success:true, message:'Message sent', data:{ message:payload } });
  } catch (err) { next(err); }
};

exports.toggleReaction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const emoji = String(req.body.emoji || '');
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success:false, message:'Invalid message.' });
    if (!ALLOWED_REACTIONS.has(emoji)) return res.status(400).json({ success:false, message:'Unsupported reaction.' });

    const message = await ChatMessage.findOne({ _id:id, room:ROOM, isDeleted:false });
    if (!message) return res.status(404).json({ success:false, message:'Message not found.' });

    let reaction = message.reactions.find(item => item.emoji === emoji);
    if (!reaction) {
      message.reactions.push({ emoji, users:[req.user._id] });
    } else {
      const index = reaction.users.findIndex(uid => String(uid) === String(req.user._id));
      if (index >= 0) reaction.users.splice(index, 1);
      else reaction.users.push(req.user._id);
      message.reactions = message.reactions.filter(item => item.users.length > 0);
    }

    await message.save();
    const payload = reactionSummary(message.reactions, req.user._id);
    safeEmit('chat:reaction-update', { messageId:String(message._id), reactions:reactionSummary(message.reactions) });
    res.json({ success:true, data:{ messageId:String(message._id), reactions:payload } });
  } catch (err) { next(err); }
};

exports.deleteMessage = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success:false, message:'Invalid message.' });

    const message = await ChatMessage.findOne({ _id:id, room:ROOM });
    if (!message) return res.status(404).json({ success:false, message:'Message not found.' });

    const owns = String(message.user) === String(req.user._id);
    if (!owns && req.user.role !== 'admin') {
      return res.status(403).json({ success:false, message:'You can only delete your own messages.' });
    }

    message.text = '';
    message.isDeleted = true;
    message.deletedAt = new Date();
    message.deletedBy = req.user._id;
    message.reactions = [];
    await message.save();

    safeEmit('chat:message-deleted', { messageId:String(message._id) });
    res.json({ success:true, message:'Message deleted', data:{ messageId:String(message._id) } });
  } catch (err) { next(err); }
};

exports.reportMessage = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ success:false, message:'Invalid message.' });

    const message = await ChatMessage.findOne({ _id:id, room:ROOM, isDeleted:false });
    if (!message) return res.status(404).json({ success:false, message:'Message not found.' });
    if (String(message.user) === String(req.user._id)) {
      return res.status(400).json({ success:false, message:'You cannot report your own message.' });
    }

    const alreadyReported = message.reports.some(report => String(report.user) === String(req.user._id));
    if (alreadyReported) return res.status(409).json({ success:false, message:'You already reported this message.' });

    const reason = sanitizeText(req.body.reason || 'Reported by user').slice(0, 160);
    message.reports.push({ user:req.user._id, reason:reason || 'Reported by user' });
    message.isFlagged = true;
    await message.save();

    res.json({ success:true, message:'Report submitted. PADDOX moderation can review it.' });
  } catch (err) { next(err); }
};

exports.serializeMessage = serializeMessage;
