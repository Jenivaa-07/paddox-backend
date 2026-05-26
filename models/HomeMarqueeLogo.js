/* ============================================================
   FILE: models/HomeMarqueeLogo.js
   PADDOX — Home Marquee Logo Manager
   ============================================================ */
const mongoose = require('mongoose');

const homeMarqueeLogoSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Logo name required'],
    trim: true,
    maxlength: 80
  },
  slug: {
    type: String,
    trim: true,
    lowercase: true
  },
  image: {
    type: String,
    required: [true, 'Logo image required'],
    maxlength: 750000
  },
  color: {
    type: String,
    default: '#e8002d',
    trim: true,
    maxlength: 32
  },
  order: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

homeMarqueeLogoSchema.index({ isActive: 1, order: 1, createdAt: -1 });
homeMarqueeLogoSchema.index({ name: 'text', slug: 'text' });

module.exports = mongoose.models.HomeMarqueeLogo || mongoose.model('HomeMarqueeLogo', homeMarqueeLogoSchema);
