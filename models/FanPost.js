/* ============================================================
   FILE: models/FanPost.js  —  Live Fan Feed
   Phase 17.7: Likes + Comments backend support
   ============================================================ */
const mongoose = require('mongoose');

const fanCommentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 220, trim: true },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const fanPostSchema = new mongoose.Schema({
  user      : { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  text      : { type:String, required:true, maxlength:280, trim:true },
  isFlagged : { type:Boolean, default:false },
  isApproved: { type:Boolean, default:true },

  /* Legacy numeric likes kept for old documents; new likes use likedBy. */
  likes     : { type:Number, default:0 },
  likedBy   : [{ type:mongoose.Schema.Types.ObjectId, ref:'User' }],
  comments  : [fanCommentSchema],
}, { timestamps:true });

fanPostSchema.index({ createdAt:-1 });
fanPostSchema.index({ isFlagged:1, isApproved:1 });
fanPostSchema.index({ likedBy:1 });
fanPostSchema.index({ 'comments.createdAt':-1 });

module.exports = mongoose.model('FanPost', fanPostSchema);
