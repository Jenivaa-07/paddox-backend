
/* ============================================================
   FILE: models/Order.js
   ============================================================ */
const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product     : { type:mongoose.Schema.Types.ObjectId, ref:'Product', required:true },
  name        : { type:String, required:true },
  image       : String,
  price       : { type:Number, required:true },
  quantity    : { type:Number, required:true, min:1 },
  size        : String,
  color       : String,
  customisation: String,
}, { _id:false });

const orderSchema = new mongoose.Schema({
  orderNumber  : { type:String, unique:true },
  user         : { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  items        : { type:[orderItemSchema], required:true },
  shippingAddress: {
    name     : { type:String, required:true },
    line1    : { type:String, required:true },
    line2    : String,
    city     : { type:String, required:true },
    state    : { type:String, required:true },
    pincode  : { type:String, required:true },
    country  : { type:String, default:'India' },
    phone    : { type:String, required:true },
  },
  pricing      : {
    subtotal   : { type:Number, required:true },
    shipping   : { type:Number, default:0 },
    discount   : { type:Number, default:0 },
    tax        : { type:Number, default:0 },
    total      : { type:Number, required:true },
  },
  payment      : {
    method          : { type:String, enum:['razorpay','cod'], default:'razorpay' },
    status          : { type:String, enum:['pending','paid','failed','refunded'], default:'pending' },
    razorpayOrderId : String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    paidAt          : Date,
  },
  status       : {
    type    : String,
    enum    : ['placed','processing','shipped','out_for_delivery','delivered','cancelled','refunded'],
    default : 'placed',
  },
  tracking     : {
    carrier        : String,
    trackingNumber : String,
    estimatedDate  : Date,
  },
  statusHistory: [{
    status    : String,
    message   : String,
    timestamp : { type:Date, default:Date.now },
  }],
  notes        : String,
  cancelReason : String,
}, { timestamps:true });

/* Auto-generate order number */
orderSchema.pre('save', async function(next) {
  if (this.isNew) {
    const count  = await mongoose.model('Order').countDocuments();
    this.orderNumber = `PDX-${String(count + 1).padStart(5,'0')}`;
    this.statusHistory.push({ status:'placed', message:'Order placed successfully' });
  }
  next();
});

orderSchema.index({ user:1, createdAt:-1 });
orderSchema.index({ orderNumber:1 });
orderSchema.index({ status:1 });

module.exports = mongoose.model('Order', orderSchema);

