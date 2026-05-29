/* ============================================================
   FILE: models/Coupon.js
   PADDOX — Coupon Code Model
   ============================================================ */
const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: [true, 'Coupon code is required'],
    unique: true,
    uppercase: true,
    trim: true,
    minlength: 3,
    maxlength: 24,
    match: [/^[A-Z0-9_-]+$/, 'Coupon code can use only letters, numbers, hyphen and underscore']
  },
  title: { type: String, trim: true, default: '' },
  description: { type: String, trim: true, default: '' },
  type: {
    type: String,
    enum: ['percent', 'fixed'],
    default: 'percent'
  },
  value: {
    type: Number,
    required: [true, 'Discount value is required'],
    min: [1, 'Discount value must be greater than 0']
  },
  minOrderValue: { type: Number, default: 0, min: 0 },
  maxUses: { type: Number, default: 0, min: 0 },
  usedCount: { type: Number, default: 0, min: 0 },
  audience: {
    type: String,
    enum: ['all', 'fans', 'new_users', 'vip'],
    default: 'all'
  },
  isActive: { type: Boolean, default: true },
  expiresAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

couponSchema.index({ code: 1 }, { unique: true });
couponSchema.index({ isActive: 1, expiresAt: 1 });

couponSchema.methods.isExpired = function isExpired() {
  return !!(this.expiresAt && this.expiresAt.getTime() < Date.now());
};

couponSchema.methods.isUsageLimitReached = function isUsageLimitReached() {
  return !!(this.maxUses && this.usedCount >= this.maxUses);
};

couponSchema.methods.calculateDiscount = function calculateDiscount(orderTotal = 0) {
  const total = Number(orderTotal || 0);
  if (this.type === 'fixed') return Math.min(Number(this.value || 0), total);
  return Math.round((total * Number(this.value || 0)) / 100);
};

module.exports = mongoose.model('Coupon', couponSchema);
