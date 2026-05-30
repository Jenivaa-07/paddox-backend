/* ============================================================
   FILE: models/Product.js
   PADDOX — FIXED PRODUCT MODEL
   Fixes: "next is not a function" during product save
   ============================================================ */

const mongoose = require('mongoose');
const slugify  = require('slugify');

const productSchema = new mongoose.Schema({
  name        : { type:String, required:[true,'Product name required'], trim:true, maxlength:120 },
  slug        : { type:String, unique:true, required:true },
  description : { type:String, required:[true,'Description required'], maxlength:2000 },
  shortDesc   : { type:String, maxlength:300 },
  team        : { type:String, required:[true,'Team required'], trim:true },
  category    : { type:String, required:true, enum:['apparel','collectibles','accessories','posters','custom'] },
  price       : { type:Number, required:[true,'Price required'], min:0 },
  salePrice   : { type:Number, default:null },
  onSale      : { type:Boolean, default:false },
  badge       : { type:String, enum:['new','hot','ltd','sale',null,''], default:null },
  images      : [{ url:{ type:String, required:true }, publicId:String, alt:String }],
  emoji       : { type:String, default:'🏎️' },
  sizes       : [{ type:String, enum:['XS','S','M','L','XL','XXL','One Size'] }],
  colors      : [String],
  stock       : { type:Number, required:true, default:0, min:0 },
  lowStockThreshold: { type:Number, default:10, min:0 },
  isLimited   : { type:Boolean, default:false },
  isActive    : { type:Boolean, default:true },
  isFeatured  : { type:Boolean, default:false },
  ratings     : {
    average : { type:Number, default:0, min:0, max:5 },
    count   : { type:Number, default:0 },
  },
  tags        : [String],
  weight      : Number,
  dimensions  : { length:Number, width:Number, height:Number },
  sku         : { type:String, unique:true, sparse:true },
  createdBy   : { type:mongoose.Schema.Types.ObjectId, ref:'User' },
}, { timestamps:true, toJSON:{ virtuals:true }, toObject:{ virtuals:true } });

/* Auto-generate slug
   IMPORTANT:
   Do NOT use next() here. Your deployed Mongoose version supports
   promise/async middleware, so calling next() caused:
   "next is not a function"
*/
productSchema.pre('save', function() {
  if (this.isModified('name') || !this.slug) {
    this.slug = slugify(this.name, { lower:true, strict:true });
  }

  if (this.badge === '') {
    this.badge = null;
  }
});

/* Virtual: effective price */
productSchema.virtual('effectivePrice').get(function() {
  return this.onSale && this.salePrice ? this.salePrice : this.price;
});

/* Virtual: discount % */
productSchema.virtual('discountPercent').get(function() {
  if (!this.onSale || !this.salePrice) return 0;
  return Math.round(((this.price - this.salePrice) / this.price) * 100);
});

/* Index for fast search */
productSchema.index({ name:'text', description:'text', team:'text', tags:'text' });
productSchema.index({ category:1, isActive:1 });
productSchema.index({ price:1 });
productSchema.index({ 'ratings.average':-1 });

module.exports =
  mongoose.models.Product ||
  mongoose.model('Product', productSchema);
