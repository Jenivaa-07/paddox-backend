
/* ============================================================
   FILE: models/Trivia.js
   ============================================================ */
const mongoose = require('mongoose');

const triviaSchema = new mongoose.Schema({
  question    : { type:String, required:true },
  options     : [{ type:String, required:true }],
  correctIndex: { type:Number, required:true, min:0, max:3 },
  difficulty  : { type:String, enum:['easy','medium','hard'], default:'medium' },
  points      : { type:Number, default:100 },
  category    : { type:String, enum:['history','drivers','teams','circuits','rules'], default:'drivers' },
  isActive    : { type:Boolean, default:true },
  createdBy   : { type:mongoose.Schema.Types.ObjectId, ref:'User' },
}, { timestamps:true });

module.exports = mongoose.model('Trivia', triviaSchema);

