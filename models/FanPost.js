
/* ============================================================
   FILE: models/FanPost.js  —  Live Fan Feed
   ============================================================ */
const mongoose = require('mongoose');

const fanPostSchema = new mongoose.Schema({
  user      : { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  text      : { type:String, required:true, maxlength:280 },
  isFlagged : { type:Boolean, default:false },
  isApproved: { type:Boolean, default:true },
  likes     : { type:Number, default:0 },
}, { timestamps:true });

fanPostSchema.index({ createdAt:-1 });
fanPostSchema.index({ isFlagged:1, isApproved:1 });

module.exports = mongoose.model('FanPost', fanPostSchema);