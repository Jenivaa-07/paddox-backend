
/* ============================================================
   FILE: models/Review.js
   ============================================================ */
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  product  : { type:mongoose.Schema.Types.ObjectId, ref:'Product', required:true },
  user     : { type:mongoose.Schema.Types.ObjectId, ref:'User', required:true },
  rating   : { type:Number, required:[true,'Rating required'], min:1, max:5 },
  title    : { type:String, trim:true, maxlength:100 },
  body     : { type:String, required:[true,'Review body required'], maxlength:1000 },
  isFlagged: { type:Boolean, default:false },
  isApproved:{ type:Boolean, default:true },
  helpful  : { type:Number, default:0 },
}, { timestamps:true });

/* One review per user per product */
reviewSchema.index({ product:1, user:1 }, { unique:true });

/* Update product average rating after save */
reviewSchema.statics.calcAverageRating = async function(productId) {
  const stats = await this.aggregate([
    { $match: { product:productId, isApproved:true } },
    { $group: { _id:'$product', avgRating:{ $avg:'$rating' }, count:{ $sum:1 } } }
  ]);
  if (stats.length > 0) {
    await mongoose.model('Product').findByIdAndUpdate(productId, {
      'ratings.average': Math.round(stats[0].avgRating * 10) / 10,
      'ratings.count'  : stats[0].count,
    });
  }
};

reviewSchema.post('save', function() {
  this.constructor.calcAverageRating(this.product);
});

module.exports = mongoose.model('Review', reviewSchema);

