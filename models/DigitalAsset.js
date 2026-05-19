
/* ============================================================
   FILE: models/DigitalAsset.js
   ============================================================ */
const mongoose = require('mongoose');

const digitalAssetSchema = new mongoose.Schema({
  name        : { type:String, required:true, trim:true },
  description : { type:String, maxlength:500 },
  category    : { type:String, enum:['cars','drivers','circuits','art','other'], required:true },
  type        : { type:String, enum:['free','premium'], default:'free' },
  resolution  : { type:String, enum:['HD','2K','4K'], default:'HD' },
  dimensions  : { width:Number, height:Number },
  fileSize    : String,
  image       : { url:{ type:String, required:true }, publicId:String },
  thumbnail   : { url:String, publicId:String },
  downloads   : { type:Number, default:0 },
  isActive    : { type:Boolean, default:true },
  uploadedBy  : { type:mongoose.Schema.Types.ObjectId, ref:'User' },
  tags        : [String],
}, { timestamps:true });

digitalAssetSchema.index({ category:1, type:1, isActive:1 });

module.exports = mongoose.model('DigitalAsset', digitalAssetSchema);
