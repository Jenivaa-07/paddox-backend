
/* ============================================================
   FILE: models/Cart.js
   ============================================================ */
const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product  : { type:mongoose.Schema.Types.ObjectId, ref:'Product', required:true },
  quantity : { type:Number, required:true, min:1, default:1 },
  size     : String,
  color    : String,
  price    : { type:Number, required:true },
}, { _id:false });

const cartSchema = new mongoose.Schema({
  user     : { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true, unique:true },
  items    : [cartItemSchema],
  coupon   : { code:String, discount:Number },
}, { timestamps:true });

/* Virtual: cart total */
cartSchema.virtual('total').get(function() {
  return this.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
});

/* Virtual: item count */
cartSchema.virtual('itemCount').get(function() {
  return this.items.reduce((sum, i) => sum + i.quantity, 0);
});

module.exports = mongoose.model('Cart', cartSchema);

