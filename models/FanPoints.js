
/* ============================================================
   FILE: models/FanPoints.js  —  Fan Activity + Points Log
   ============================================================ */
const mongoose = require('mongoose');

const fanPointsSchema = new mongoose.Schema({
  user    : { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  action  : {
    type : String,
    enum : ['purchase','review','trivia','poll_vote','fan_post','login_streak','referral','download'],
    required: true,
  },
  points  : { type:Number, required:true },
  meta    : { type:mongoose.Schema.Types.Mixed, default:{} },
}, { timestamps:true });

fanPointsSchema.index({ user:1, createdAt:-1 });

module.exports = mongoose.model('FanPoints', fanPointsSchema);

