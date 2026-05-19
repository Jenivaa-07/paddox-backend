
/* ============================================================
   FILE: models/Poll.js
   ============================================================ */
const mongoose = require('mongoose');

const pollSchema = new mongoose.Schema({
  question  : { type:String, required:true },
  options   : [{
    label : { type:String, required:true },
    votes : { type:Number, default:0 },
  }],
  voters    : [{ type:mongoose.Schema.Types.ObjectId, ref:'User' }],
  isActive  : { type:Boolean, default:true },
  endsAt    : Date,
  createdBy : { type:mongoose.Schema.Types.ObjectId, ref:'User' },
}, { timestamps:true });

module.exports = mongoose.model('Poll', pollSchema);
