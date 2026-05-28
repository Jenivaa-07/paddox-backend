/* ============================================================
   FILE: models/Poll.js
   PADDOX — Realtime Fan Polls with team logo options
   ============================================================ */
const mongoose = require('mongoose');

const pollOptionSchema = new mongoose.Schema({
  label     : { type:String, required:true, trim:true },
  votes     : { type:Number, default:0, min:0 },

  /* Phase 17.6 — optional logo metadata from Home Branding logos */
  logo      : { type:String, default:'' },
  teamName  : { type:String, default:'' },
  teamColor : { type:String, default:'#e8002d' },
  logoKey   : { type:String, default:'' },
}, { _id:false });

const pollSchema = new mongoose.Schema({
  question  : { type:String, required:true, trim:true },
  options   : [pollOptionSchema],
  voters    : [{ type:mongoose.Schema.Types.ObjectId, ref:'User' }],
  isActive  : { type:Boolean, default:true },
  endsAt    : Date,
  createdBy : { type:mongoose.Schema.Types.ObjectId, ref:'User' },
}, { timestamps:true });

pollSchema.index({ isActive:1, createdAt:-1 });

module.exports = mongoose.model('Poll', pollSchema);
