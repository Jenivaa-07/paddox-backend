
/* ============================================================
   FILE: models/Newsletter.js
   ============================================================ */
const mongoose = require('mongoose');

const newsletterSchema = new mongoose.Schema({
  email      : { type:String, required:true, unique:true, lowercase:true, trim:true },
  isActive   : { type:Boolean, default:true },
  source     : { type:String, enum:['home','checkout','account','popup'], default:'home' },
  unsubToken : String,
}, { timestamps:true });

module.exports = mongoose.model('Newsletter', newsletterSchema);
