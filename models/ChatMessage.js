/* ============================================================
   PADDOX — Fan Hub Live Grid Chat Message
   ============================================================ */
const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema({
  emoji: { type:String, required:true, maxlength:8 },
  users: [{ type:mongoose.Schema.Types.ObjectId, ref:'User' }]
}, { _id:false });

const reportSchema = new mongoose.Schema({
  user: { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  reason: { type:String, trim:true, maxlength:160, default:'Reported by user' },
  createdAt: { type:Date, default:Date.now }
}, { _id:false });

const chatMessageSchema = new mongoose.Schema({
  room: { type:String, trim:true, maxlength:60, default:'global', index:true },
  user: { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true, index:true },
  text: { type:String, required:true, trim:true, maxlength:500 },
  replyTo: { type:mongoose.Schema.Types.ObjectId, ref:'ChatMessage', default:null },
  reactions: { type:[reactionSchema], default:[] },
  reports: { type:[reportSchema], default:[] },
  isFlagged: { type:Boolean, default:false, index:true },
  isDeleted: { type:Boolean, default:false, index:true },
  deletedAt: { type:Date, default:null },
  deletedBy: { type:mongoose.Schema.Types.ObjectId, ref:'User', default:null }
}, { timestamps:true });

chatMessageSchema.index({ room:1, createdAt:-1 });
chatMessageSchema.index({ room:1, isDeleted:1, createdAt:-1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
