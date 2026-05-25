/* ============================================================
   FILE: models/Quote.js
   PADDOX — Fan Hub Quote Library
   ============================================================ */
const mongoose = require('mongoose');

const quoteSchema = new mongoose.Schema({
  text: {
    type: String,
    required: [true, 'Quote text required'],
    trim: true,
    maxlength: 500
  },
  driver: {
    type: String,
    required: [true, 'Driver name required'],
    trim: true
  },
  team: {
    type: String,
    default: '',
    trim: true
  },
  era: {
    type: String,
    enum: ['current', 'legend', 'principal', 'other'],
    default: 'current'
  },
  category: {
    type: String,
    default: 'motivation',
    trim: true
  },
  avatar: {
    type: String,
    default: '🏎️'
  },
  source: {
    type: String,
    default: '',
    trim: true
  },
  isFeatured: {
    type: Boolean,
    default: false
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

quoteSchema.index({ driver: 'text', text: 'text', team: 'text', category: 'text' });
quoteSchema.index({ isActive: 1, era: 1, isFeatured: -1, createdAt: -1 });

module.exports =
  mongoose.models.Quote ||
  mongoose.model('Quote', quoteSchema);
